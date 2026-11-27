pub(crate) mod clip;
pub(crate) mod convert;
pub(crate) mod simplify;
pub(crate) mod split;
pub(crate) mod tile;
pub mod types;
pub(crate) mod wrap;

use std::sync::Arc;

use geojson_lib::GeoJson;
use navara_quadtree::{QuadLeafHandle, decode_quadleaf_handle, encode_quadleaf_handle};
use rustc_hash::FxHashMap;

use crate::convert::convert;
use crate::split::{split_tile, tile_key};
use crate::types::{BBox, Tile};
use crate::wrap::wrap;

/// Options for GeoJSON indexing.
#[derive(Debug, Clone)]
pub struct Options {
    /// Maximum zoom level to preserve detail on. Affects simplification tolerance.
    /// The higher zoom level would improve the performance, but unexpected tile splitting might occur.
    pub max_zoom: u32,
    /// Maximum zoom level for pre-indexing. Tiles beyond this are generated on demand.
    pub index_max_zoom: u32,
    /// Maximum number of points per tile before further splitting stops.
    pub index_max_points: u32,
    /// Tile extent in tile coordinate units.
    pub extent: u32,
    /// Buffer around each tile in tile coordinate units.
    pub buffer: u32,
    /// Simplification tolerance.
    pub tolerance: f64,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            max_zoom: 12,
            index_max_zoom: 5,
            index_max_points: 100_000,
            extent: 4096,
            buffer: 64,
            tolerance: 2.0,
        }
    }
}

/// A spatial index for GeoJSON features, organized into XYZ tiles.
///
/// Pre-indexes features up to `index_max_zoom` and generates tiles
/// on demand for higher zoom levels.
pub struct GeoJsonVt {
    tiles: FxHashMap<navara_quadtree::QuadLeafHandle, Tile>,
    /// Source features stored at leaf tiles for on-demand drill-down.
    sources: FxHashMap<navara_quadtree::QuadLeafHandle, Vec<Arc<types::InternalFeature>>>,
    options: Options,
}

pub type TileKey = QuadLeafHandle;

impl GeoJsonVt {
    /// Creates a new index from a GeoJSON document.
    pub fn new(geojson: &GeoJson, options: Options) -> Self {
        let buffer_ratio = (options.buffer as f64) / (options.extent as f64);

        // Compute simplification tolerance for the convert phase
        let z2_max = (1u64 << options.max_zoom) as f64;
        let sq_tolerance = (options.tolerance / (z2_max * options.extent as f64)).powi(2);

        // Convert GeoJSON features to internal representation (with simplification)
        let features = convert(geojson, sq_tolerance);
        let features: Vec<Arc<types::InternalFeature>> =
            features.into_iter().map(Arc::new).collect();

        // Handle antimeridian wrapping
        let features = wrap(&features, buffer_ratio);

        // Split features into tiles up to index_max_zoom
        let mut tiles = FxHashMap::default();
        let mut sources = FxHashMap::default();
        split_tile(features, &mut tiles, &mut sources, &options, 0, 0, 0, None);

        Self {
            tiles,
            sources,
            options,
        }
    }

    /// Encodes tile coordinates into a [`TileKey`].
    /// Returns `None` if coordinates are out of range.
    pub fn key(&self, z: u32, x: u32, y: u32) -> Option<TileKey> {
        encode_quadleaf_handle((x, y, z))
    }

    /// Retrieves a tile at the given coordinates.
    ///
    /// For zoom levels up to `index_max_zoom`, returns the pre-indexed tile.
    /// For higher zoom levels, drills down from the nearest ancestor tile
    /// that has stored source features.
    pub fn get_tile(&mut self, z: u32, x: u32, y: u32) -> Option<&Tile> {
        let key = self.key(z, x, y)?;

        // If tile already exists, return it
        if self.tiles.contains_key(&key) {
            return self.tiles.get(&key);
        }

        // Walk up to find the nearest ancestor with source features
        let mut z0 = z;
        let mut x0 = x;
        let mut y0 = y;
        let mut parent_key = None;

        while z0 > 0 {
            z0 -= 1;
            x0 >>= 1;
            y0 >>= 1;
            let ancestor_key = tile_key(x0, y0, z0);
            if let Some(ancestor_tile) = self.tiles.get(&ancestor_key) {
                if !self.intersect_with_ancestor(ancestor_tile, z, x, y) {
                    return None;
                }
                // Only stop if this ancestor also has source features.
                // Intermediate ancestors from a prior drill-down may have tiles
                // but no sources (consumed by split_tile and never restored).
                if self.sources.contains_key(&ancestor_key) {
                    parent_key = Some(ancestor_key);
                    break;
                }
            }
        }

        let parent_key = parent_key?;
        let is_pre_indexed = z0 <= self.options.index_max_zoom;
        let source = self.sources.remove(&parent_key)?;

        let mut split = |source| {
            split_tile(
                source,
                &mut self.tiles,
                &mut self.sources,
                &self.options,
                z0,
                x0,
                y0,
                Some((z, x, y)),
            );
        };

        // Drill down from the ancestor to the target tile
        if is_pre_indexed {
            split(source.clone());

            // Restore pre-indexed source so evict+re-drill works.
            // split_tile removes the starting source during drilling, but
            // pre-indexed sources must survive for future drill-down regeneration.
            self.sources.insert(parent_key, source);
        } else {
            split(source);
        }

        self.tiles.get(&key)
    }

    /// Checks if a tile exists at the given coordinates.
    ///
    /// Includes both pre-indexed and drill-down-generated tiles.
    /// Does not trigger on-demand generation.
    pub fn has_tile(&self, z: u32, x: u32, y: u32) -> bool {
        self.key(z, x, y)
            .is_some_and(|k| self.tiles.contains_key(&k))
    }

    /// Predicts whether a tile at the given coordinates is likely to contain features,
    /// without triggering on-demand drill-down.
    ///
    /// Returns:
    /// - [`PredictState::Matched`] — the tile already exists in the index.
    /// - [`PredictState::Intersected`] — the tile doesn't exist yet, but an ancestor's
    ///   feature bounding box overlaps this tile's extent, so a [`get_tile`](Self::get_tile)
    ///   call would likely produce data.
    /// - [`PredictState::NotFound`] — no ancestor features overlap this region.
    pub fn predict(&self, z: u32, x: u32, y: u32) -> PredictState {
        // 1. Tile exists → Matched
        if let Some(key) = self.key(z, x, y)
            && self.tiles.contains_key(&key)
        {
            return PredictState::Matched;
        }

        // 2. Walk up to find nearest ancestor tile
        let mut z0 = z;
        let mut x0 = x;
        let mut y0 = y;
        while z0 > 0 {
            z0 -= 1;
            x0 >>= 1;
            y0 >>= 1;
            if let Some(ancestor_key) = self.key(x0, y0, z0)
                && let Some(ancestor_tile) = self.tiles.get(&ancestor_key)
            {
                if self.intersect_with_ancestor(ancestor_tile, z, x, y) {
                    return PredictState::Intersected;
                }
                return PredictState::NotFound;
            }
        }
        PredictState::NotFound
    }

    fn intersect_with_ancestor(&self, ancestor_tile: &Tile, z: u32, x: u32, y: u32) -> bool {
        if let Some(ref features_bbox) = ancestor_tile.features_bbox {
            let tile_bbox = tile_geographic_bbox(z, x, y);
            if features_bbox.intersects(&tile_bbox) {
                return true;
            }
        }
        false
    }

    /// Returns the total number of tiles, including any drill-down tiles
    /// generated by previous `get_tile` calls.
    pub fn tile_count(&self) -> usize {
        self.tiles.len()
    }

    /// Returns an iterator over all tiles, including any drill-down tiles
    /// generated by previous `get_tile` calls.
    pub fn tiles(&self) -> impl Iterator<Item = &Tile> {
        self.tiles.values()
    }

    /// Removes a drill-down tile from the cache.
    ///
    /// Only removes tiles beyond `index_max_zoom`. Pre-indexed tiles
    /// are never removed — they're needed for drill-down regeneration.
    /// Returns `true` if anything was removed.
    pub fn remove_tile(&mut self, key: TileKey) -> bool {
        let (_, _, z): (u32, u32, u32) = decode_quadleaf_handle(key);
        if z <= self.options.index_max_zoom {
            return false;
        }
        let a = self.tiles.remove(&key).is_some();
        let b = self.sources.remove(&key).is_some();
        a || b
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PredictState {
    /// Tile exists in the index.
    Matched,
    /// Tile doesn't exist, but ancestor features intersect this tile's extent.
    Intersected,
    /// No data overlaps this tile region.
    NotFound,
}

fn tile_geographic_bbox(z: u32, x: u32, y: u32) -> BBox {
    let z2 = (1u64 << z) as f64;
    BBox {
        min_x: x as f64 / z2,
        min_y: y as f64 / z2,
        max_x: (x + 1) as f64 / z2,
        max_y: (y + 1) as f64 / z2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_feature_collection() -> GeoJson {
        serde_json::from_str(
            r#"{
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
                            ]
                        },
                        "properties": {"name": "square"}
                    }
                ]
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn test_new_and_get_tile_z0() {
        let geojson = sample_feature_collection();
        let mut vt = GeoJsonVt::new(&geojson, Options::default());

        let tile = vt.get_tile(0, 0, 0);
        assert!(tile.is_some());
        let tile = tile.unwrap();
        assert_eq!(tile.z, 0);
        assert_eq!(tile.x, 0);
        assert_eq!(tile.y, 0);
        assert!(!tile.features.is_empty());
    }

    #[test]
    fn test_empty_tile() {
        let geojson = sample_feature_collection();
        let mut vt = GeoJsonVt::new(&geojson, Options::default());

        let tile = vt.get_tile(5, 31, 31);
        assert!(tile.is_none());
    }

    #[test]
    fn test_property_sharing() {
        let geojson = sample_feature_collection();
        let mut vt = GeoJsonVt::new(&geojson, Options::default());

        let tile = vt.get_tile(0, 0, 0).unwrap();
        assert_eq!(
            tile.features[0].properties["name"],
            serde_json::json!("square")
        );
    }

    /// The top-level `id` survives `convert`, `clip` (a polygon split across the
    /// z1 tiles at lng 0) and `wrap` (a polygon crossing the antimeridian), and
    /// stays apart from a property named `$id`.
    #[test]
    fn test_feature_id_survives_clip_and_wrap() {
        use geojson_lib::feature::Id;

        let geojson: GeoJson = serde_json::from_str(
            r#"{
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "id": 1,
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-10, 5], [10, 5], [10, 15], [-10, 15], [-10, 5]]]
                        },
                        "properties": {}
                    },
                    {
                        "type": "Feature",
                        "id": "am",
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[170, 5], [190, 5], [190, 15], [170, 15], [170, 5]]]
                        },
                        "properties": {}
                    },
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-10, 20], [10, 20], [10, 30], [-10, 30], [-10, 20]]]
                        },
                        "properties": {"$id": "b"}
                    }
                ]
            }"#,
        )
        .unwrap();
        let mut vt = GeoJsonVt::new(&geojson, Options::default());

        let id_1 = Some(Id::Number(1.into()));
        let id_am = Some(Id::String("am".to_string()));
        // The west (x=0) and east (x=1) z1 tiles each hold a clipped piece of
        // every feature: the lng-0 square directly, the antimeridian one via wrap.
        for x in 0..2 {
            let tile = vt.get_tile(1, x, 0).expect("tile should exist");
            let ids: Vec<_> = tile.features.iter().map(|f| f.id.clone()).collect();
            assert!(ids.contains(&id_1), "x={x}: clipped square lost its id");
            assert!(ids.contains(&id_am), "x={x}: wrapped polygon lost its id");
            let b = tile
                .features
                .iter()
                .find(|f| f.properties.get("$id").is_some())
                .expect("the `$id` property feature should be in the tile");
            assert_eq!(b.id, None, "x={x}: a `$id` property must not become the id");
        }
    }

    #[test]
    fn test_multiple_features() {
        let geojson: GeoJson = serde_json::from_str(
            r#"{
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [0, 0]},
                        "properties": {"id": 1}
                    },
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [90, 45]},
                        "properties": {"id": 2}
                    }
                ]
            }"#,
        )
        .unwrap();

        let mut vt = GeoJsonVt::new(&geojson, Options::default());
        let tile = vt.get_tile(0, 0, 0);
        assert!(tile.is_some());
        let tile = tile.unwrap();
        assert_eq!(tile.features.len(), 2);
    }

    #[test]
    fn test_features_bbox_computed() {
        let geojson = sample_feature_collection();
        let vt = GeoJsonVt::new(&geojson, Options::default());

        let tile = vt.tiles.values().find(|t| t.z == 0).unwrap();
        let bbox = tile.features_bbox.as_ref().unwrap();
        // Polygon (0,0)-(10,10) in lon/lat projects to roughly x:[0.5,0.528] y:[0.472,0.5]
        assert!(bbox.min_x >= 0.4 && bbox.min_x <= 0.55);
        assert!(bbox.max_x >= 0.5 && bbox.max_x <= 0.55);
    }

    #[test]
    fn test_predict_matched_for_existing_tile() {
        let geojson = sample_feature_collection();
        let vt = GeoJsonVt::new(&geojson, Options::default());

        assert_eq!(vt.predict(0, 0, 0), PredictState::Matched);
    }

    #[test]
    fn test_predict_not_found_for_distant_tile() {
        let geojson = sample_feature_collection();
        let vt = GeoJsonVt::new(&geojson, Options::default());

        assert_eq!(vt.predict(5, 31, 31), PredictState::NotFound);
    }

    #[test]
    fn test_predict_not_found_for_child_outside_features() {
        let geojson = sample_feature_collection();
        let opts = Options {
            index_max_zoom: 2,
            ..Default::default()
        };
        let vt = GeoJsonVt::new(&geojson, opts);

        // At z=3, tile (0, 0) covers x:[0,0.125] y:[0,0.125] — far from features
        assert_eq!(vt.predict(3, 0, 0), PredictState::NotFound);
    }

    #[test]
    fn test_get_tile_early_return_no_intersection() {
        // Non-intersecting request should skip split_tile entirely.
        let geojson = sample_feature_collection();
        let opts = Options {
            index_max_zoom: 2,
            ..Default::default()
        };
        let mut vt = GeoJsonVt::new(&geojson, opts);
        let before = vt.tile_count();

        let tile = vt.get_tile(3, 0, 0);
        assert!(tile.is_none(), "tile outside features_bbox should be None");

        // Tile count must not increase — no split_tile was invoked.
        assert_eq!(
            vt.tile_count(),
            before,
            "no new tiles should be created for non-intersecting request"
        );
    }

    #[test]
    fn test_intersect_with_ancestor_directly() {
        let geojson = sample_feature_collection();
        let opts = Options {
            index_max_zoom: 2,
            ..Default::default()
        };
        let vt = GeoJsonVt::new(&geojson, opts);

        let z0_key = tile_key(0, 0, 0);
        let ancestor = vt.tiles.get(&z0_key).unwrap();

        assert!(vt.intersect_with_ancestor(ancestor, 3, 4, 3));
        assert!(!vt.intersect_with_ancestor(ancestor, 3, 0, 0));
        assert!(!vt.intersect_with_ancestor(ancestor, 3, 7, 7));
    }

    #[test]
    fn test_predict_matched_after_drill_down() {
        let geojson = sample_feature_collection();
        let opts = Options {
            index_max_zoom: 2,
            ..Default::default()
        };
        let mut vt = GeoJsonVt::new(&geojson, opts);

        assert_eq!(vt.predict(3, 4, 3), PredictState::Intersected);

        let tile = vt.get_tile(3, 4, 3);
        assert!(tile.is_some());

        assert_eq!(vt.predict(3, 4, 3), PredictState::Matched);
    }

    #[test]
    fn test_evict_all_intermediates_and_leaf_then_redrill() {
        // Simulates what clear_caches does when the user zooms out:
        // ALL drill-down tiles (z=3, z=4, z=5) are evicted, not just the leaf.
        // Re-drill must still succeed by finding the pre-indexed z=2 source.
        let geojson = sample_feature_collection();
        let opts = Options {
            index_max_zoom: 2,
            ..Default::default()
        };
        let mut vt = GeoJsonVt::new(&geojson, opts);

        let tile = vt.get_tile(5, 16, 15);
        assert!(tile.is_some(), "initial drill to z=5 should succeed");
        let original_count = tile.unwrap().features.len();

        // Evict all drill-down tiles like clear_caches would.
        // z=5 (16,15) -> z=4 (8,7) -> z=3 (4,3)
        for &(z, x, y) in &[(3, 4, 3), (4, 8, 7), (5, 16, 15)] {
            let key = vt.key(z, x, y).unwrap();
            vt.remove_tile(key);
        }

        assert!(!vt.has_tile(5, 16, 15));
        assert!(!vt.has_tile(4, 8, 7));
        assert!(!vt.has_tile(3, 4, 3));

        let tile = vt.get_tile(5, 16, 15);
        assert!(
            tile.is_some(),
            "re-drill after evicting all intermediates should succeed"
        );
        assert_eq!(tile.unwrap().features.len(), original_count);
    }

    #[test]
    fn test_non_pre_indexed_source_consumed_on_deeper_drill() {
        // With index_max_zoom=0, drill to z=2. This creates a non-pre-indexed
        // source at z=2. Then drill deeper to z=4 from z=2.
        // The z=2 source is consumed (not cloned, since z=2 > index_max_zoom=0).
        // Evict z=4, then re-drill to z=4 — must still work by falling back to z=0.
        let geojson = sample_feature_collection();
        let opts = Options {
            index_max_zoom: 0,
            ..Default::default()
        };
        let mut vt = GeoJsonVt::new(&geojson, opts);

        let tile_z2 = vt.get_tile(2, 2, 1);
        assert!(tile_z2.is_some(), "z=2 drill should succeed");

        let tile_z4 = vt.get_tile(4, 8, 7);
        assert!(
            tile_z4.is_some(),
            "z=4 drill from non-pre-indexed z=2 should succeed"
        );
        let original_count = tile_z4.unwrap().features.len();

        let key = vt.key(4, 8, 7).unwrap();
        vt.remove_tile(key);

        // z=2 source was consumed (not restored since z=2 > index_max_zoom=0).
        // Walk-up must fall back to z=0 (pre-indexed).
        let tile_z4_again = vt.get_tile(4, 8, 7);
        assert!(
            tile_z4_again.is_some(),
            "re-drill to z=4 after non-pre-indexed source consumption should succeed"
        );
        assert_eq!(tile_z4_again.unwrap().features.len(), original_count);
    }

    #[test]
    fn test_predict_after_deep_eviction_with_intermediates_present() {
        // Evict only the leaf; intermediates (z=3, z=4) remain.
        let geojson = sample_feature_collection();
        let opts = Options {
            index_max_zoom: 2,
            ..Default::default()
        };
        let mut vt = GeoJsonVt::new(&geojson, opts);

        assert!(vt.get_tile(5, 16, 15).is_some());

        let key = vt.key(5, 16, 15).unwrap();
        vt.remove_tile(key);

        // Intermediates (z=3, z=4) still have features_bbox → Intersected
        let state = vt.predict(5, 16, 15);
        assert_ne!(state, PredictState::Matched);
        assert_eq!(
            state,
            PredictState::Intersected,
            "evicted z=5 with intermediates present should be Intersected"
        );
    }

    #[test]
    fn test_remove_tile_does_not_remove_pre_indexed_sources() {
        // Verify that remove_tile refuses to remove tiles at or below index_max_zoom,
        // ensuring the pre-indexed source chain is never broken.
        let geojson = sample_feature_collection();
        let opts = Options {
            index_max_zoom: 2,
            ..Default::default()
        };
        let mut vt = GeoJsonVt::new(&geojson, opts);

        for z in 0..=2 {
            for x in 0..(1u32 << z) {
                for y in 0..(1u32 << z) {
                    if let Some(key) = vt.key(z, x, y) {
                        assert!(!vt.remove_tile(key), "remove_tile should refuse z={z} tile");
                    }
                }
            }
        }

        let tile = vt.get_tile(5, 16, 15);
        assert!(tile.is_some());
    }

    #[test]
    fn test_evict_and_redrill_different_target() {
        // Pre-indexed source must support drilling to different targets
        // after eviction of a previous target.
        let geojson: GeoJson = serde_json::from_str(
            r#"{
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]]
                            ]
                        },
                        "properties": {"name": "wide_square"}
                    }
                ]
            }"#,
        )
        .unwrap();

        let opts = Options {
            index_max_zoom: 2,
            ..Default::default()
        };
        let mut vt = GeoJsonVt::new(&geojson, opts);

        let tile_a = vt.get_tile(5, 16, 15);
        assert!(tile_a.is_some(), "first z=5 target should succeed");
        let count_a = tile_a.unwrap().features.len();

        let key_a = vt.key(5, 16, 15).unwrap();
        vt.remove_tile(key_a);

        // Drill a different z=5 tile sharing the same ancestor.
        let _tile_b = vt.get_tile(5, 15, 16);

        let tile_a2 = vt.get_tile(5, 16, 15);
        assert!(
            tile_a2.is_some(),
            "re-drill of first target after drilling second should succeed"
        );
        assert_eq!(tile_a2.unwrap().features.len(), count_a);
    }

    #[test]
    fn test_walk_up_skips_ancestors_without_source_in_get_tile() {
        // After deep drilling, intermediate ancestors have tiles but no sources
        // (consumed by split_tile). Walk-up must skip them on re-drill.
        let geojson = sample_feature_collection();
        let opts = Options {
            index_max_zoom: 2,
            ..Default::default()
        };
        let mut vt = GeoJsonVt::new(&geojson, opts);

        let initial = vt.get_tile(5, 16, 15);
        assert!(initial.is_some());
        let original_count = initial.unwrap().features.len();

        let z3_key = vt.key(3, 4, 3).unwrap();
        let z4_key = vt.key(4, 8, 7).unwrap();
        assert!(vt.tiles.contains_key(&z3_key), "z=3 tile should exist");
        assert!(vt.tiles.contains_key(&z4_key), "z=4 tile should exist");
        assert!(
            !vt.sources.contains_key(&z3_key),
            "z=3 should NOT have source (consumed during drill)"
        );
        assert!(
            !vt.sources.contains_key(&z4_key),
            "z=4 should NOT have source (consumed during drill)"
        );

        let z5_key = vt.key(5, 16, 15).unwrap();
        vt.remove_tile(z5_key);

        let tile = vt.get_tile(5, 16, 15);
        assert!(
            tile.is_some(),
            "walk-up must skip source-less intermediates and find pre-indexed source"
        );
        assert_eq!(tile.unwrap().features.len(), original_count);
    }

    #[test]
    fn test_predict_with_evicted_intermediates() {
        // After evicting ALL drill-down tiles (including intermediates),
        // predict should still return Intersected by finding the pre-indexed ancestor.
        let geojson = sample_feature_collection();
        let opts = Options {
            index_max_zoom: 2,
            ..Default::default()
        };
        let mut vt = GeoJsonVt::new(&geojson, opts);

        assert!(vt.get_tile(5, 16, 15).is_some());

        for &(z, x, y) in &[(5, 16, 15), (4, 8, 7), (3, 4, 3)] {
            let key = vt.key(z, x, y).unwrap();
            vt.remove_tile(key);
        }

        // Pre-indexed ancestor at z=2 still has features_bbox
        let state = vt.predict(5, 16, 15);
        assert_eq!(
            state,
            PredictState::Intersected,
            "predict should find pre-indexed ancestor after full eviction"
        );
    }
}
