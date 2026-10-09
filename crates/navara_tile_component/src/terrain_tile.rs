use bevy_ecs::prelude::*;
use navara_buffer_store::BufferStore;
use navara_component::{Deleted, Order};
use navara_core::{
    Aabb, Ellipsoid, Extent, LngLat, PoleSides, Radians, TileRegion, TileXYZ, TilingScheme,
    WGS84_64, get_ellipsoid_terrain_level_zero_maximum_geometric_error_with_root_tiles,
    get_level_maximum_geometric_error, vec3_to_xyz,
};
use navara_data_requester::{DataRequester, DataRequesterStatus};
use navara_geometry::{ReturnedConstructedTerrainMesh, UpsamplableTerrainGeometry};
use navara_math::{Transform, Vec3};

use navara_mesh::CachedMeshHandle;
use navara_quadtree::{Coords, encode_quadleaf_handle};

use crate::{
    HillshadeCancelRequested, TerrainExaggeration, TerrainTileQuadtree, Tile, TileHandle,
    terrain::TerrainData, terrain_data_requester::TileTerrainDataRequesterQuery,
};

use navara_layer::{TerrainDataType, TerrainLayer, TilesLayer};
use navara_math::FloatType;

use super::tile_bounding_region::TileBoundingRegion;

// Note Tile have to keep light size for caching efficiently.
// So if you want to store large data in this struct, use [`BufferStore`].
// And don't forget to destroy the stored data in [`Tile::destroy method`].
// TODO: Rename this struct like `TerrainBasedTile` or `GlobeTile`,
//      since this struct mostly manage both the terrain and raster tiles.
#[derive(Debug)]
pub struct TerrainTile {
    pub coords: TileXYZ,
    pub extent: Extent<FloatType, Radians>,
    pub aabb: Aabb,
    pub bounding_region: Option<TileBoundingRegion<FloatType>>,
    /// Unextended region used *only* for the screen-space-error distance, and
    /// only for polar tiles. `bounding_region` is stretched to the pole so the
    /// height-zero cap is neither frustum- nor horizon-culled, but the cap is
    /// identical at every zoom: subdividing a polar tile narrows its wedge
    /// without adding a single cap vertex. Measuring the SSE distance against
    /// the stretched region therefore made a camera near the pole refine the
    /// top tile row to max zoom, turning each cap into a ~550 km needle (a
    /// 52.8 m wedge at z16 — 10,000:1). Refinement must follow the tile's real
    /// terrain instead.
    pub sse_bounding_region: Option<TileBoundingRegion<FloatType>>,
    pub children: Vec<TileHandle>,
    pub were_children_rendered: bool,
    /// Set by the terrain traversal in the frame this tile's children group
    /// became complete: the tile hands the screen to that group once the
    /// nearest ancestor whose own group is still incomplete (or the root)
    /// applies the swap. Cleared when the tile is traversed again.
    pub children_take_over: Option<ChildrenTakeOver>,
    pub rendered_at: usize,
    pub visited_at: usize,
    pub terrain_data: Option<Box<dyn TerrainData>>,
    pub hillshade_entity_ids: Option<Vec<Option<Entity>>>,
    pub occludee_point_in_scaled_space: Option<Vec3>,
    pub cached_mesh_handle: Option<CachedMeshHandle>,
    /// Whether it's upsampled tile or not.
    pub upsampled: bool,
    /// Zoom level of the ancestor the current upsampled mesh was built from
    /// (`None` unless the mesh is upsampled). Kept so a tile that never gets a
    /// DEM of its own can be rebuilt once a nearer source appears (see
    /// [`Self::has_stale_upsample_source`]).
    pub upsample_source_z: Option<usize>,
    /// The last upsample task for this tile failed (its source vanished mid
    /// flight, typically after a tiling rebuild). The tile stops counting as
    /// upsamplable and fetches its own DEM instead of retrying forever.
    pub upsample_failed: bool,
    /// Unexaggerated terrain heights. The bounding volumes are built from
    /// these mapped through `exaggeration`.
    pub max_height: f64,
    pub min_height: f64,
    /// Exaggeration the bounding volumes were built with; the traversal syncs
    /// it on every visit ([`Self::set_exaggeration`]).
    pub exaggeration: TerrainExaggeration,
    pub distance_from_camera: FloatType,
    pub sse: FloatType,
    pub tiling_scheme: TilingScheme,
}

impl Clone for TerrainTile {
    fn clone(&self) -> Self {
        Self {
            coords: self.coords,
            extent: self.extent,
            aabb: self.aabb.clone(),
            bounding_region: self.bounding_region.clone(),
            sse_bounding_region: self.sse_bounding_region.clone(),
            // Note: `children` needs to be updated dynamically.
            children: vec![],
            were_children_rendered: false,
            children_take_over: None,
            rendered_at: self.rendered_at,
            visited_at: self.visited_at,
            terrain_data: self.terrain_data.as_ref().map(|t| t.box_clone()),
            hillshade_entity_ids: self.hillshade_entity_ids.clone(),
            occludee_point_in_scaled_space: self.occludee_point_in_scaled_space,
            cached_mesh_handle: self.cached_mesh_handle.clone(),
            upsampled: self.upsampled,
            upsample_source_z: self.upsample_source_z,
            upsample_failed: self.upsample_failed,
            max_height: self.max_height,
            min_height: self.min_height,
            exaggeration: self.exaggeration,
            distance_from_camera: 0.,
            sse: 0.,
            tiling_scheme: self.tiling_scheme.clone(),
        }
    }
}

/// Per-child-slot bitmasks (bit `i` is `children[i]`) recorded by the terrain
/// traversal for a tile whose children take over the screen.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ChildrenTakeOver {
    /// Children that in turn hand off to their own children.
    pub activated: u8,
    /// Children that stay hidden (culled or not renderable).
    pub hidden: u8,
    /// Children of an on-screen group that came into view without a prepared
    /// mesh yet: hidden until prepared, and the parent fills their quadrants
    /// (`Mesh::fill_quadrants`) in the meantime.
    pub held: u8,
    /// Children whose own descendants are on screen and cover them (a
    /// zoom-out waiting for the child's DEM): the child stays hidden and its
    /// subtree is left as it is — its own traversal manages it.
    pub covered: u8,
}

/// How many levels above a tile its upsample source may sit. Upsampling
/// clips (quantized mesh) or resamples (raster DEM) the ancestor's data down
/// to the tile, so a source many levels up yields a near-flat patch at an
/// interpolated height: a ground-level camera then sees the terrain float
/// above or sink below the real surface until the tile's own DEM lands. With
/// this bound a tile whose nearest real-data ancestor is farther up is not
/// renderable, which lets the traversal's ladder
/// (`MAX_LEVELS_WITHOUT_RENDERABLE_ANCESTOR`) fetch real DEMs on the way down
/// instead of upsampling every level from a z1 tile. The bound does not apply
/// where no DEM of the tile's own will ever land: the overscale band and
/// tiles whose DEM request failed (see
/// `TerrainTile::is_upsample_depth_bounded`).
pub const MAX_UPSAMPLE_DEPTH: usize = 2;

/// The nearest ancestors a tile can be upsampled from, each with its zoom
/// level. The terrain traversal hands this down and extends it by one level
/// per recursion (`extend_with`), so every traversed tile resolves its source
/// in O(1) instead of walking the quadtree; `TerrainTile::upsample_ancestors`
/// is the walking equivalent for callers outside the traversal.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct UpsampleAncestors {
    /// Nearest ancestor holding real terrain data, with its zoom level: a mesh
    /// built from its own data, or — for raster DEM, which resamples the
    /// source's DEM pixels rather than its mesh — its own landed DEM.
    pub real: Option<(TileHandle, usize)>,
    /// Nearest ancestor whose mesh carries heights but was itself upsampled,
    /// with its zoom level.
    pub upsampled: Option<(TileHandle, usize)>,
}

impl UpsampleAncestors {
    /// The ancestors for the children of `tile`: `tile` itself when it holds
    /// real data or its mesh carries heights, the inherited ones otherwise.
    /// `dem_landed` is whether the tile's own DEM has landed, counted only for
    /// raster DEM (see [`Self::real`]).
    pub fn extend_with(self, tile: &TerrainTile, handle: TileHandle, dem_landed: bool) -> Self {
        let has_heights = tile
            .cached_mesh_handle
            .as_ref()
            .is_some_and(|m| m.heights.is_some());
        if dem_landed || (has_heights && !tile.upsampled) {
            Self {
                real: Some((handle, tile.coords.z)),
                ..self
            }
        } else if has_heights {
            Self {
                upsampled: Some((handle, tile.coords.z)),
                ..self
            }
        } else {
            self
        }
    }

    /// The ancestor a tile at `tile_z` should upsample from: the nearest one
    /// with real terrain data, or — when `allow_upsampled` and no real one is
    /// on the path — the nearest upsampled one. Only meshes carrying heights
    /// qualify (flat ellipsoid tiles do not). Quantized mesh clips the
    /// source's TIN, so an upsampled source works; raster DEM resamples the
    /// source's DEM pixels, which only a tile whose own DEM landed has.
    ///
    /// When `bounded`, a source more than [`MAX_UPSAMPLE_DEPTH`] levels up is
    /// rejected and the tile waits for real data. A real ancestor that is too
    /// far up never falls back to a nearer upsampled one: that mesh derives
    /// from the same (or a farther) real ancestor, so it is no better.
    pub fn source(self, allow_upsampled: bool, tile_z: usize, bounded: bool) -> Option<TileHandle> {
        let within_bound = |(_, z): &(TileHandle, usize)| {
            !bounded || tile_z.saturating_sub(*z) <= MAX_UPSAMPLE_DEPTH
        };
        match self.real {
            Some(real) => within_bound(&real).then_some(real.0),
            None if allow_upsampled => self.upsampled.filter(within_bound).map(|(h, _)| h),
            None => None,
        }
    }
}

#[derive(Default)]
pub struct ReadyState {
    pub is_tile_ready: bool,
    pub is_texture_ready: bool,
    pub is_terrain_ready: bool,
    pub is_upsamplable: bool,
    pub use_terrain: bool,
}

impl TerrainTile {
    pub fn new(coords: TileXYZ, max_height: FloatType, min_height: FloatType) -> Self {
        Self::new_with_scheme(
            coords,
            max_height,
            min_height,
            TilingScheme::WebMercator { tms: false },
        )
    }

    pub fn new_with_scheme(
        coords: TileXYZ,
        max_height: FloatType,
        min_height: FloatType,
        tiling_scheme: TilingScheme,
    ) -> Self {
        let extent = tiling_scheme.tile_extent(coords);
        let sides = PoleSides::from_extent(&tiling_scheme, &extent);
        let bounds_extent = sides.extended_extent(extent);
        let (bounds_min, bounds_max) = sides.height_range(min_height, max_height, 0.);

        let mut bounding_region = TileBoundingRegion::from_extent_f64(bounds_extent, WGS84_64);
        bounding_region.minimum_height = bounds_min;
        bounding_region.maximum_height = bounds_max;

        let sse_bounding_region = (bounds_extent != extent).then(|| {
            let mut region = TileBoundingRegion::from_extent_f64(extent, WGS84_64);
            region.minimum_height = min_height;
            region.maximum_height = max_height;
            region
        });

        Self {
            coords,
            extent,
            aabb: Aabb::from_extent_f64(bounds_extent, bounds_min, bounds_max),
            bounding_region: Some(bounding_region),
            sse_bounding_region,
            exaggeration: TerrainExaggeration::default(),
            rendered_at: 0,
            visited_at: 0,
            terrain_data: None,
            hillshade_entity_ids: None,
            occludee_point_in_scaled_space: None,
            cached_mesh_handle: None,
            upsampled: false,
            upsample_source_z: None,
            upsample_failed: false,
            children: Vec::with_capacity(4),
            were_children_rendered: false,
            children_take_over: None,
            max_height,
            min_height,
            distance_from_camera: 0.,
            sse: 0.,
            tiling_scheme,
        }
    }

    /// Rebuild the bounding volumes for a new exaggeration. A no-op when it
    /// is unchanged, so the traversal can call it on every visit.
    pub fn set_exaggeration(&mut self, exaggeration: TerrainExaggeration) {
        if self.exaggeration == exaggeration {
            return;
        }
        self.exaggeration = exaggeration;
        self.rebuild_bounds();
    }

    /// Unexaggerated bounds of a mesh whose terrain heights span
    /// `min_height..=max_height`, i.e. of the geometry as uploaded (the
    /// renderer adds the exaggeration on the GPU and widens its bounds itself).
    pub fn mesh_bounds(&self, min_height: f64, max_height: f64) -> MeshBounds {
        let sides = PoleSides::from_extent(&self.tiling_scheme, &self.extent);
        let (min_height, max_height) = sides.height_range(min_height, max_height, 0.);
        MeshBounds {
            aabb: Aabb::from_extent_f64(sides.extended_extent(self.extent), min_height, max_height),
            min_height,
            max_height,
        }
    }

    fn rebuild_bounds(&mut self) {
        let max_height = self.exaggeration.apply(self.max_height);
        let min_height = self.exaggeration.apply(self.min_height);
        let sides = PoleSides::from_extent(&self.tiling_scheme, &self.extent);
        let (min, max) = sides.height_range(min_height, max_height, self.exaggeration.apply(0.));
        if let Some(bounding_region) = &mut self.bounding_region {
            bounding_region.maximum_height = max;
            bounding_region.minimum_height = min;
        }
        if let Some(region) = &mut self.sse_bounding_region {
            region.maximum_height = max_height;
            region.minimum_height = min_height;
        }
        self.aabb
            .update(sides.extended_extent(self.extent), min, max);
        self.occludee_point_in_scaled_space = None;
    }

    #[allow(clippy::too_many_arguments)]
    pub fn is_ready(
        &self,
        upsample_ancestors: UpsampleAncestors,
        data_requesters: &Query<&navara_data_requester::DataRequester>,
        terrain_data_requester: &TileTerrainDataRequesterQuery,
        terrain_layer: &Option<&TerrainLayer>,
        sorted_layers: &[(&TilesLayer, &Order)],
        source_store: &navara_source::SourceStore,
    ) -> ReadyState {
        let is_texture_loaded =
            self.is_hillshade_ready(data_requesters, sorted_layers, source_store);

        // Terrain fetch/zoom config is read live from the referenced source.
        let terrain_source = terrain_layer
            .and_then(|l| l.source_id.as_deref())
            .and_then(|id| source_store.get(id));

        let data_requester_entity_id = self
            .terrain_data
            .as_ref()
            .and_then(|t| t.data_requester_entity_id());

        let use_terrain = terrain_source.is_some_and(|s| s.is_over_min_zoom(self.coords.z));

        // Terrain isn't used at this tile (no terrain layer, or below its min
        // zoom): the tile renders as flat geometry, which is always ready. The
        // regular raster textures are draped via the raster pull (with ancestor
        // fallback), so readiness no longer waits on terrain-owned textures.
        if !use_terrain && data_requester_entity_id.is_none() {
            return ReadyState {
                is_tile_ready: true,
                is_texture_ready: is_texture_loaded,
                use_terrain,
                ..Default::default()
            };
        }

        // For ellipsoid terrain, terrain is always ready (no data loading needed)
        let is_ellipsoid_terrain = terrain_layer
            .map(|l| matches!(l.terrain_type, navara_layer::TerrainDataType::Ellipsoid))
            .unwrap_or(false);

        let is_terrain_ready = if is_ellipsoid_terrain {
            true
        } else {
            self.is_terrain_ready(terrain_data_requester)
        };

        let is_terrain_failed = self.is_terrain_failed(terrain_data_requester);
        let in_overscale_band = terrain_source.is_some_and(|s| s.should_overscale(self.coords.z));
        // The depth bound is lifted exactly where no DEM of the tile's own will
        // ever land (see `is_upsample_depth_bounded`).
        let has_upsample_source = self.is_upsamplable(
            upsample_ancestors,
            terrain_layer,
            !in_overscale_band && !is_terrain_failed,
        );

        // Upsample-first: a tile without its own DEM renders from the nearest
        // ready ancestor right away (fetch pending, never fetched, or failed),
        // and the real DEM replaces it later. The one hold-out is zoom-out: a
        // tile whose children are on screen already shows finer data than any
        // ancestor could give, so it waits for its own DEM instead — unless
        // no DEM will ever come, because it sits in the overscale band or its
        // request failed.
        let can_upsample = has_upsample_source
            && !is_terrain_ready
            && (in_overscale_band || is_terrain_failed || !self.were_children_rendered);
        // Last-resort flat fallback: failed and no ancestor terrain to upsample from.
        let should_be_rendered_without_terrain = is_terrain_failed && !has_upsample_source;

        ReadyState {
            is_tile_ready: is_terrain_ready || can_upsample || should_be_rendered_without_terrain,
            is_texture_ready: is_texture_loaded,
            is_terrain_ready,
            is_upsamplable: can_upsample,
            use_terrain,
        }
    }

    pub fn get_terrain_data_requester(
        &self,
        terrain_data_requester: &TileTerrainDataRequesterQuery,
    ) -> Option<DataRequester> {
        let data_requester_entity_id = self
            .terrain_data
            .as_ref()
            .and_then(|t| t.data_requester_entity_id());
        data_requester_entity_id.and_then(|e| {
            terrain_data_requester
                .get(e)
                .map_or(None, |d| Some(d.1.clone()))
        })
    }

    /// Whether a hillshade entity's data has finished loading. Hillshade is
    /// terrain-owned and backed by a `DataRequester` (Rust backfills its edges),
    /// so this checks the requester only. Regular raster textures are owned by
    /// the raster pipeline (see `resolve_raster_texture`).
    pub fn is_hillshade_entity_ready(
        entity: Entity,
        data_requesters: &Query<&navara_data_requester::DataRequester>,
    ) -> bool {
        data_requesters
            .get(entity)
            .is_ok_and(|dr| dr.is_succeeded())
    }

    pub fn is_terrain_ready(
        &self,
        terrain_data_requesters: &TileTerrainDataRequesterQuery,
    ) -> bool {
        let terrain_data_requester = self.get_terrain_data_requester(terrain_data_requesters);
        // Narrow contract: this tile owns ready DEM data. Fail+parent-ready upsampling
        // is handled by the caller (see `is_ready`).
        terrain_data_requester.is_some_and(|s| matches!(s.status, DataRequesterStatus::Success))
    }

    /// Whether this tile's own DEM request failed. A failed request is never
    /// retried, so no DEM will land on the tile.
    pub fn is_terrain_failed(
        &self,
        terrain_data_requesters: &TileTerrainDataRequesterQuery,
    ) -> bool {
        self.get_terrain_data_requester(terrain_data_requesters)
            .is_some_and(|s| matches!(s.status, DataRequesterStatus::Fail))
    }

    /// Walk the quadtree from the root down to this tile's parent, building
    /// the `UpsampleAncestors` the traversal would hand down (`dem_landed` as
    /// in [`UpsampleAncestors::extend_with`], per ancestor). This is a
    /// quadtree lookup per level, so it is for per-event callers (starting an
    /// upsample task), not for the per-frame traversal. Ancestors on the
    /// traversal path keep their cached mesh, so a hit is the usual case for
    /// any tile whose region has terrain on screen.
    pub fn upsample_ancestors(
        &self,
        qt: &TerrainTileQuadtree,
        dem_landed: impl Fn(&TerrainTile) -> bool,
    ) -> UpsampleAncestors {
        let mut ancestors = UpsampleAncestors::default();
        for z in 0..self.coords.z {
            let Some(ancestor) = qt
                .qt
                .ancestor((self.coords.x, self.coords.y, self.coords.z), z)
            else {
                continue;
            };
            let handle = ancestor.handle();
            let Some(tile) = qt.qt.get(handle) else {
                continue;
            };
            ancestors = ancestors.extend_with(tile, handle, dem_landed(tile));
        }
        ancestors
    }

    /// The ancestor this tile should be upsampled from (see
    /// `UpsampleAncestors::source`), resolved by walking the quadtree.
    /// `bounded` applies the [`MAX_UPSAMPLE_DEPTH`] bound (see
    /// [`Self::is_upsample_depth_bounded`]).
    pub fn find_upsample_source(
        &self,
        qt: &TerrainTileQuadtree,
        dem_landed: impl Fn(&TerrainTile) -> bool,
        allow_upsampled: bool,
        bounded: bool,
    ) -> Option<TileHandle> {
        self.upsample_ancestors(qt, dem_landed)
            .source(allow_upsampled, self.coords.z, bounded)
    }

    /// Whether the tile can be upsampled: a terrain layer exists, an ancestor
    /// holds a mesh with heights within the depth bound (when `bounded`, see
    /// [`Self::is_upsample_depth_bounded`]), and the last upsample did not
    /// fail.
    pub fn is_upsamplable(
        &self,
        upsample_ancestors: UpsampleAncestors,
        terrain_layer: &Option<&TerrainLayer>,
        bounded: bool,
    ) -> bool {
        let Some(layer) = terrain_layer else {
            return false;
        };
        let allow_upsampled = matches!(layer.terrain_type, TerrainDataType::QuantizedMesh);
        !self.upsample_failed
            && upsample_ancestors
                .source(allow_upsampled, self.coords.z, bounded)
                .is_some()
    }

    /// Whether [`MAX_UPSAMPLE_DEPTH`] applies to this tile. It is lifted where
    /// no DEM of the tile's own will ever land, so upsampling from any depth
    /// is the only way to render it: the overscale band (past the source's
    /// `max_zoom`) and a tile whose DEM request failed (never retried).
    pub fn is_upsample_depth_bounded(
        &self,
        terrain_layer: &Option<&TerrainLayer>,
        source_store: &navara_source::SourceStore,
        terrain_data_requester: &TileTerrainDataRequesterQuery,
    ) -> bool {
        let in_overscale_band = terrain_layer
            .and_then(|l| l.source_id.as_deref())
            .and_then(|id| source_store.get(id))
            .is_some_and(|s| s.should_overscale(self.coords.z));
        !in_overscale_band && !self.is_terrain_failed(terrain_data_requester)
    }

    /// Whether this tile's upsampled mesh is worth rebuilding from the nearest
    /// real-data ancestor, which is nearer than the one it was built from.
    ///
    /// Only for tiles whose depth bound is lifted — the overscale band and a
    /// failed DEM request — so callers pair this with
    /// [`Self::is_upsample_depth_bounded`]: every other tile has a DEM of its
    /// own coming that replaces the mesh outright.
    ///
    /// The levels above turn real one at a time, so a rebuild waits for a
    /// source worth a worker task: one within [`MAX_UPSAMPLE_DEPTH`] of the
    /// tile, a jump of at least that many levels, or the last one the tile
    /// will ever get. `is_final(real_z)` answers that last question — whether
    /// no tile between that ancestor and this one can still come to hold real
    /// data — and is asked only when the cheaper tests fail.
    pub fn has_stale_upsample_source(
        &self,
        upsample_ancestors: UpsampleAncestors,
        is_final: impl FnOnce(usize) -> bool,
    ) -> bool {
        // A tile whose last upsample failed cannot be rebuilt by upsampling
        // (`should_upsample_terrain` refuses it).
        if self.upsample_failed {
            return false;
        }
        let (Some(source_z), Some((_, real_z))) = (self.upsample_source_z, upsample_ancestors.real)
        else {
            return false;
        };
        real_z > source_z
            && (self.coords.z - real_z <= MAX_UPSAMPLE_DEPTH
                || real_z - source_z >= MAX_UPSAMPLE_DEPTH
                || is_final(real_z))
    }

    /// Terrain-side texture readiness. Regular raster textures are owned by the
    /// raster pipeline and pulled separately (with ancestor fallback), so this
    /// only gates on hillshade layers, which derive from the terrain DEM.
    /// `sorted_layers` is the layer list sorted by `Order`, collected once per
    /// system run (this is called per traversed tile).
    pub fn is_hillshade_ready(
        &self,
        data_requesters: &Query<&navara_data_requester::DataRequester>,
        sorted_layers: &[(&TilesLayer, &Order)],
        source_store: &navara_source::SourceStore,
    ) -> bool {
        if sorted_layers.is_empty() {
            return true;
        }

        // Check if there are any hillshade layers in the sorted tiles
        let has_hillshade_layers = sorted_layers
            .iter()
            .any(|(layer, _)| layer.hillshade_config.is_some());

        // If no hillshade layers exist, default to true (nothing to wait for)
        if !has_hillshade_layers {
            return true;
        }

        // Has hillshade layers, check if entities are ready
        self.hillshade_entity_ids.as_ref().is_none_or(|hill_ids| {
            hill_ids
                .iter()
                .zip(sorted_layers.iter())
                .any(|(&entity_opt, (layer, _))| {
                    if let Some(entity) = entity_opt {
                        // Entity exists, check if it's ready
                        TerrainTile::is_hillshade_entity_ready(entity, data_requesters)
                    } else {
                        // Entity is None, check if this layer is beyond max_zoom
                        // (resolved live from its source).
                        layer.hillshade_config.is_some()
                            && layer
                                .source_id
                                .as_deref()
                                .and_then(|id| source_store.get(id))
                                .is_some_and(|s| s.is_over_max_zoom(self.coords.z))
                    }
                })
        })
    }

    /// Quadrant path from `ancestor` down to this tile, one region per level:
    /// the first entry is the ancestor's child on the way, the last this tile.
    /// `None` unless `ancestor` is a strict ancestor of this tile.
    ///
    /// Uses tile coordinates rather than extents to detect each quadrant. Both
    /// WebMercator and Geographic schemes share XYZ-style y (y=0 at the north
    /// edge), so the relationship between parent and child indices is
    /// identical: `(2x, 2y)` is the NW child, `(2x+1, 2y+1)` the SE, etc. An
    /// extent-based check using the arithmetic midpoint of latitude is
    /// incorrect for WebMercator: the projection is non-linear in lat, so the
    /// boundary between north and south children does not sit at
    /// `(south + north) / 2` (visible in the southern hemisphere, where the
    /// north child was misidentified as a south one).
    pub fn region_path_from(&self, ancestor: &TerrainTile) -> Option<Vec<TileRegion>> {
        if ancestor.coords.z >= self.coords.z {
            return None;
        }
        let depth = self.coords.z - ancestor.coords.z;
        if (self.coords.x >> depth) != ancestor.coords.x
            || (self.coords.y >> depth) != ancestor.coords.y
        {
            return None;
        }
        let mut path = Vec::with_capacity(depth);
        for level in (0..depth).rev() {
            let is_east = (self.coords.x >> level) % 2 == 1;
            let is_north = (self.coords.y >> level).is_multiple_of(2);
            path.push(match (is_east, is_north) {
                (false, true) => TileRegion::NorthWest,
                (true, true) => TileRegion::NorthEast,
                (false, false) => TileRegion::SouthWest,
                (true, false) => TileRegion::SouthEast,
            });
        }
        Some(path)
    }

    /// Build this tile's mesh from the mesh of `source`, any strict ancestor:
    /// the ancestor geometry is clipped quadrant by quadrant along
    /// [`Self::region_path_from`] and re-projected onto this tile's extent.
    pub fn upsample(
        &self,
        ellipsoid: Ellipsoid<FloatType>,
        source: &TerrainTile,
        upsamplable_geometry: UpsamplableTerrainGeometry,
    ) -> Option<ReturnedConstructedTerrainMesh> {
        let regions = self.region_path_from(source)?;

        let mut upsampled_mesh = self
            .terrain_data
            .as_ref()
            .and_then(|t| t.upsample(&regions, upsamplable_geometry))?;

        // RTC origin only: the pole extension is excluded so the origin stays on
        // the terrain grid it makes precise. Cap vertices are placed from
        // absolute coordinates, and culling uses `TerrainTile::aabb` instead.
        let aabb = Aabb::from_extent_f64(
            self.extent,
            upsampled_mesh.min_height,
            upsampled_mesh.max_height,
        );
        let tile_center = aabb.center;

        // Generate geometry directly in local RTC space
        let (geometry, heights) = upsampled_mesh.construct_geometry(
            ellipsoid,
            &self.extent,
            &tile_center,
            matches!(self.tiling_scheme, TilingScheme::WebMercator { .. }),
        );

        Some(ReturnedConstructedTerrainMesh {
            geometry,
            heights,
            max_height: upsampled_mesh.max_height,
            min_height: upsampled_mesh.min_height,
            rtc_translation: Some(tile_center),
            watermask: upsampled_mesh.watermask.take(),
        })
    }

    /// Free the cached mesh buffers (shared with the tile's `Mesh` component)
    /// and forget them. Called on destroy and when a real-DEM mesh replaces an
    /// upsampled one.
    pub fn release_cached_mesh(&mut self, buf: &mut BufferStore) {
        if let Some(cached_mesh) = self.cached_mesh_handle.take() {
            buf.remove(&cached_mesh.vertices);
            buf.remove(&cached_mesh.indices);
            buf.remove(&cached_mesh.uvs);
            if let Some(h) = &cached_mesh.heights {
                buf.remove(h);
            }
            if let Some(h) = &cached_mesh.normals {
                buf.remove(h);
            }
            if let Some(h) = &cached_mesh.watermask {
                buf.remove(h);
            }
        }
    }

    // This function will be invoked before this tile is destroyed.
    pub fn destroy(&mut self, commands: &mut Commands, buf: &mut BufferStore) {
        self.release_cached_mesh(buf);

        if let Some(hillshade_entities) = self.hillshade_entity_ids.take() {
            for hillshade_entity in hillshade_entities.into_iter().flatten() {
                commands
                    .entity(hillshade_entity)
                    .insert((Deleted, HillshadeCancelRequested));
            }
        }

        if let Some(t) = &mut self.terrain_data {
            if let Some(e) = t.data_requester_entity_id() {
                // Don't remove the handle directly - it may be shared with other consumers
                // (e.g., hillshade). Let remove_removed_data_requesters handle cleanup
                // via DataManager's refcounting.
                commands.entity(e).insert(Deleted);
                t.set_data_requester_entity_id(None);
            }
            t.destroy(buf);
        }
        self.upsampled = false;
        self.upsample_source_z = None;
        self.upsample_failed = false;
    }
}

impl Tile for TerrainTile {
    type CoordUnit = usize;

    fn aabb(&self) -> &Aabb {
        &self.aabb
    }

    fn bounding_region(&self) -> Option<&TileBoundingRegion<FloatType>> {
        self.bounding_region.as_ref()
    }

    /// Distance driving the screen-space error. Polar tiles measure against
    /// their unextended extent so the cap cannot pull refinement toward the
    /// pole; see [`TerrainTile::sse_bounding_region`].
    fn calc_distance_from_camera(
        &self,
        camera: &Transform,
        ellipsoid: &Ellipsoid<FloatType>,
    ) -> FloatType {
        let region = self
            .sse_bounding_region
            .as_ref()
            .or(self.bounding_region.as_ref())
            .unwrap();
        let camera_pos = camera.transform_point(Vec3::ZERO);
        region.distance_to_camera(camera_pos, ellipsoid.xyz_to_lle(vec3_to_xyz(camera_pos)))
    }

    fn coords(&self) -> &TileXYZ {
        &self.coords
    }

    fn extent(&self) -> &Extent<FloatType, Radians> {
        &self.extent
    }

    fn children(&self) -> &[TileHandle] {
        &self.children
    }

    fn set_children(&mut self, children: Vec<TileHandle>) {
        self.children = children;
    }

    fn occludee_point_in_scaled_space(&self) -> Option<&Vec3> {
        self.occludee_point_in_scaled_space.as_ref()
    }

    fn set_occludee_point_in_scaled_space(&mut self, p: Option<Vec3>) {
        self.occludee_point_in_scaled_space = p;
    }

    fn max_height(&self) -> f64 {
        self.terrain_data
            .as_ref()
            .and_then(|t| t.current_max_height())
            .unwrap_or(self.max_height)
    }
    fn min_height(&self) -> f64 {
        self.terrain_data
            .as_ref()
            .and_then(|t| t.current_min_height())
            .unwrap_or(self.min_height)
    }
    fn update_heights(&mut self, max_height: f64, min_height: f64) {
        if self.max_height == max_height && self.min_height == min_height {
            return;
        }
        self.max_height = max_height;
        self.min_height = min_height;
        self.rebuild_bounds();
    }

    fn has_terrain(&self) -> bool {
        self.terrain_data.is_some()
    }

    fn get_level_maximum_geometric_error(
        &self,
        ellipsoid: &Ellipsoid<FloatType>,
        height_map_width: FloatType,
    ) -> FloatType {
        get_level_maximum_geometric_error(
            self.coords.z,
            // TODO: Store the result of the level zero maximum geometric error to avoid too many caclulation.
            // Scheme-aware (Cesium `getNumberOfXTilesAtLevel(0)`): a Geographic terrain has 2
            // level-zero tiles in X, so its error is halved and it subdivides one level coarser
            // than WebMercator for the same ground area — keeping the draped WM tile zoom
            // (derived from this tile's longitude span) consistent across terrain schemes.
            get_ellipsoid_terrain_level_zero_maximum_geometric_error_with_root_tiles(
                ellipsoid,
                height_map_width,
                self.tiling_scheme.root_tiles().len(),
            ),
        )
    }

    fn tiling_scheme(&self) -> TilingScheme {
        self.tiling_scheme.clone()
    }

    fn new_child(
        (x, y, z): Coords<Self::CoordUnit>,
        max_height: f64,
        min_height: f64,
        tiling_scheme: TilingScheme,
    ) -> Self {
        Self::new_with_scheme(TileXYZ { x, y, z }, max_height, min_height, tiling_scheme)
    }
}

/// Height of the rendered (exaggerated) terrain surface at the given point.
pub fn compute_terrain_height_at_point(
    qt: &mut TerrainTileQuadtree,
    buf: &mut BufferStore,
    terrain_data_requesters: &TileTerrainDataRequesterQuery,
    exaggeration: &TerrainExaggeration,
    point: &LngLat<FloatType, Radians>,
) -> Option<FloatType> {
    let tile_handle = find_contained_child(
        qt,
        &|t| t.extent.contains(point) && t.cached_mesh_handle.is_some() && !t.upsampled,
        &|t| t.extent.contains(point),
    )?;
    let tile = qt.qt.get_mut(tile_handle)?;

    tile.terrain_data
        .as_mut()?
        .compute_height_at_point(&tile.extent, buf, terrain_data_requesters, point)
        .map(|h| exaggeration.apply(h))
}

/// Merges the height range of `tile`'s loaded mesh into `range`.
fn extend_with_mesh_heights(range: &mut Option<(FloatType, FloatType)>, tile: &TerrainTile) {
    if tile.cached_mesh_handle.is_none() || tile.upsampled {
        return;
    }
    let Some(terrain_data) = tile.terrain_data.as_ref() else {
        return;
    };
    if let (Some(tile_min), Some(tile_max)) = (
        terrain_data.current_min_height(),
        terrain_data.current_max_height(),
    ) {
        *range = Some(match *range {
            Some((min, max)) => (min.min(tile_min), max.max(tile_max)),
            None => (tile_min, tile_max),
        });
    }
}

/// Min and max height over `extent` of the deepest loaded terrain tile along
/// each branch that covers at least the extent's area, or `None` when none
/// has terrain data.
fn loaded_terrain_height_range(
    qt: &TerrainTileQuadtree,
    extent: Extent<f64, Radians>,
) -> Option<(FloatType, FloatType)> {
    let tiles = find_contained_children(
        qt,
        &|t| {
            t.extent.intersects(extent)
                && extent.ratio(&t.extent) <= 1.
                && t.cached_mesh_handle.is_some()
                && !t.upsampled
                && t.terrain_data.is_some()
        },
        &|t| t.extent.intersects(extent),
    );

    let mut range = None;
    for tile in tiles.into_iter().filter_map(|handle| qt.qt.get(handle)) {
        extend_with_mesh_heights(&mut range, tile);
    }
    range
}

/// Min and max height, relative to the ellipsoid, of the ground rendered
/// (exaggerated) over `extent`, or the flat surface at height 0 (exaggerated
/// like any terrain height) before any terrain has loaded.
///
/// Reads every loaded tile over the extent, not only the deepest: a parent
/// still renders the quadrants whose children have not loaded, and a coarser
/// tile misses peaks a finer one renders. An upsampled tile repeats a loaded
/// ancestor's heights.
pub fn terrain_height_range(
    qt: &TerrainTileQuadtree,
    exaggeration: &TerrainExaggeration,
    extent: Extent<f64, Radians>,
) -> (FloatType, FloatType) {
    let mut range = None;
    let mut stack = root_handles(qt);
    while let Some(handle) = stack.pop() {
        let Some(tile) = qt.qt.get(handle) else {
            continue;
        };
        if !tile.extent.intersects(extent) {
            continue;
        }
        extend_with_mesh_heights(&mut range, tile);
        stack.extend(tile.children.iter().copied());
    }
    let (min, max) = range.unwrap_or((0., 0.));
    (exaggeration.apply(min), exaggeration.apply(max))
}

/// Range `(min, max)` of the rendered (exaggerated) terrain surface within
/// `extent`, or `None` when no ready terrain tile overlaps it.
pub fn sample_terrain_height_within_extent(
    qt: &TerrainTileQuadtree,
    exaggeration: &TerrainExaggeration,
    extent: Extent<f64, Radians>,
) -> Option<(FloatType, FloatType)> {
    loaded_terrain_height_range(qt, extent)
        .map(|(min, max)| (exaggeration.apply(min), exaggeration.apply(max)))
}

/// Collect the deepest ready terrain tiles from the quadtree.
/// Returns handles of the deepest tiles (not necessarily quadtree leaves) that
/// have cached mesh, terrain data, and are not upsampled.
/// Used to batch-resolve terrain heights without per-point tree traversal.
pub fn collect_terrain_leaves(qt: &TerrainTileQuadtree) -> Vec<TileHandle> {
    // No spatial filter — every ready tile is wanted regardless of location, so
    // the full tree must be walked (`overlaps` always true, no pruning).
    find_contained_children(
        qt,
        &|t| t.cached_mesh_handle.is_some() && !t.upsampled && t.terrain_data.is_some(),
        &|_| true,
    )
}

/// Find the deepest raster tile whose extent fully contains the given extent.
/// This is used to find the best-matching terrain tile for a vector tile feature,
/// avoiding per-point quadtree traversal.
///
/// Uses containment (not intersection) so the returned tile's DEM grid covers
/// all points within the given extent.
pub fn find_terrain_tile_for_extent(
    qt: &TerrainTileQuadtree,
    extent: &Extent<FloatType, Radians>,
) -> Option<TileHandle> {
    find_contained_child(
        qt,
        &|t| {
            t.extent.contains_extent(extent)
                && t.cached_mesh_handle.is_some()
                && !t.upsampled
                && t.terrain_data.is_some()
        },
        &|t| t.extent.contains_extent(extent),
    )
}

/// See [`TerrainTile::mesh_bounds`].
pub struct MeshBounds {
    pub aabb: Aabb,
    /// Height range the geometry spans: the terrain heights, widened to
    /// height 0 by a pole cap.
    pub min_height: f64,
    pub max_height: f64,
}

/// Rendered (exaggerated) terrain elevation `(max_height, min_height)` over the
/// WebMercator tile `coords`: the range of the terrain tiles of the same size
/// covering it, each replaced by its nearest ancestor with a mesh while it has
/// none. Where no rendered terrain covers it, the surface is flat at height 0
/// (exaggerated like any terrain height).
pub fn terrain_height_for_tile(
    qt: &TerrainTileQuadtree,
    exaggeration: &TerrainExaggeration,
    coords: TileXYZ,
) -> (FloatType, FloatType) {
    let mut range: Option<(FloatType, FloatType)> = None;
    let mut extend = |c: TileXYZ| {
        if let Some(tile) = nearest_tile_with_mesh(qt, c) {
            range = Some(match range {
                Some((max, min)) => (max.max(tile.max_height), min.min(tile.min_height)),
                None => (tile.max_height, tile.min_height),
            });
        }
    };

    let scheme = encode_quadleaf_handle((0usize, 0, 0))
        .and_then(|h| qt.qt.get(h))
        .map(|root| &root.tiling_scheme);
    match scheme {
        Some(TilingScheme::WebMercator { .. }) => extend(coords),
        Some(scheme @ TilingScheme::Geographic { .. }) => {
            // Geographic level z-1 shares WebMercator level z's columns; a
            // tile spans one or two of its rows. The corners are pulled inside
            // so that an edge on a tile boundary does not select the neighbour.
            let level = coords.z.saturating_sub(1);
            let extent = TilingScheme::WebMercator { tms: false }.tile_extent(coords);
            let inset_lng = (extent.east - extent.west) * 1e-6;
            let inset_lat = (extent.north - extent.south) * 1e-6;
            let north_west = scheme.position_to_tile_xy(
                LngLat {
                    lng: extent.west + inset_lng,
                    lat: extent.north - inset_lat,
                },
                level,
            );
            let south_east = scheme.position_to_tile_xy(
                LngLat {
                    lng: extent.east - inset_lng,
                    lat: extent.south + inset_lat,
                },
                level,
            );
            for x in north_west.x..=south_east.x {
                for y in north_west.y..=south_east.y {
                    extend(TileXYZ { x, y, z: level });
                }
            }
        }
        None => {}
    }

    let (max_height, min_height) = range.unwrap_or((0., 0.));
    (
        exaggeration.apply(max_height),
        exaggeration.apply(min_height),
    )
}

/// `coords`' tile, or its nearest ancestor, that has a mesh.
fn nearest_tile_with_mesh(qt: &TerrainTileQuadtree, mut coords: TileXYZ) -> Option<&TerrainTile> {
    loop {
        if let Some(tile) = encode_quadleaf_handle((coords.x, coords.y, coords.z))
            .and_then(|h| qt.qt.get(h))
            .filter(|tile| tile.cached_mesh_handle.is_some())
        {
            return Some(tile);
        }
        if coords.z == 0 {
            return None;
        }
        coords = TileXYZ {
            x: coords.x >> 1,
            y: coords.y >> 1,
            z: coords.z - 1,
        };
    }
}

/// Rendered (exaggerated) terrain height for a single point from a known
/// tile. A height that cannot be determined is taken as 0 before exaggeration.
pub fn compute_terrain_height_by_tile_handle(
    qt: &mut TerrainTileQuadtree,
    buf: &mut BufferStore,
    terrain_data_requesters: &TileTerrainDataRequesterQuery,
    exaggeration: &TerrainExaggeration,
    tile_handle: TileHandle,
    point: &LngLat<FloatType, Radians>,
) -> f64 {
    let height = qt.qt.get_mut(tile_handle).and_then(|tile| {
        let extent = tile.extent;
        tile.terrain_data.as_mut()?.compute_height_at_point(
            &extent,
            buf,
            terrain_data_requesters,
            point,
        )
    });
    exaggeration.apply(height.unwrap_or(0.0))
}

/// Collect handles of all root tiles based on the tiling scheme carried by the
/// `(0, 0, 0)` tile. For WebMercator this is a single handle; for Geographic it
/// is two — `(0, 0, 0)` and `(1, 0, 0)`.
pub fn root_handles(qt: &TerrainTileQuadtree) -> Vec<TileHandle> {
    let Some(zero_handle) = qt.qt.zero().map(|l| l.handle()) else {
        return vec![];
    };
    let Some(zero_tile) = qt.qt.get(zero_handle) else {
        return vec![];
    };
    zero_tile
        .tiling_scheme
        .root_tiles()
        .into_iter()
        .filter_map(|c| qt.qt.leaf((c.x, c.y, c.z)).map(|l| l.handle()))
        .collect()
}

/// Find the deepest tile satisfying `contain`.
///
/// `overlaps` is a spatial pruning predicate: a subtree is descended into only
/// when its root tile passes `overlaps`. It MUST be downward-monotone along the
/// tree (if a tile passes, every ancestor passes — equivalently, if a tile
/// fails, no descendant can satisfy `contain`). Because child extents partition
/// their parent's extent, the spatial part of `contain` (e.g. `extent.contains`,
/// `extent.intersects`, `extent.contains_extent`) is such a predicate. Pruning
/// turns this from a full `O(tree)` walk into an `O(depth)` descent — without
/// it, every terrain tile is visited for every query, which is called per raster
/// tile per frame in the raster traversal.
///
/// Pass `|_| true` when no spatial pruning is possible (full traversal).
fn find_contained_child(
    qt: &TerrainTileQuadtree,
    contain: &dyn Fn(&TerrainTile) -> bool,
    overlaps: &dyn Fn(&TerrainTile) -> bool,
) -> Option<TileHandle> {
    for root in root_handles(qt) {
        if let Some(v) =
            traverse_contained_child(qt, qt.qt.get(root), Some(root), contain, overlaps)
        {
            return Some(v);
        }
    }
    None
}

/// Collect the deepest tile satisfying `contain` along each branch. See
/// [`find_contained_child`] for the contract on `overlaps`.
fn find_contained_children(
    qt: &TerrainTileQuadtree,
    contain: &dyn Fn(&TerrainTile) -> bool,
    overlaps: &dyn Fn(&TerrainTile) -> bool,
) -> Vec<TileHandle> {
    let mut result = vec![];
    for root in root_handles(qt) {
        let previous_len = result.len();
        if let Some(v) = traverse_contained_children(
            qt,
            qt.qt.get(root),
            Some(root),
            contain,
            overlaps,
            &mut result,
        ) && previous_len == result.len()
        {
            result.push(v);
        }
    }
    result
}

fn traverse_contained_child(
    qt: &TerrainTileQuadtree,
    tile: Option<&TerrainTile>,
    handle: Option<TileHandle>,
    contain: &dyn Fn(&TerrainTile) -> bool,
    overlaps: &dyn Fn(&TerrainTile) -> bool,
) -> Option<TileHandle> {
    let h = handle?;
    let tile = tile?;

    // Prune: if this tile cannot spatially overlap the query, neither can any of
    // its descendants, so skip the whole subtree.
    if !overlaps(tile) {
        return None;
    }

    for child in &tile.children {
        if let Some(v) =
            traverse_contained_child(qt, qt.qt.get(*child), Some(*child), contain, overlaps)
        {
            return Some(v);
        }
    }

    if contain(tile) {
        return Some(h);
    }

    None
}

fn traverse_contained_children(
    qt: &TerrainTileQuadtree,
    tile: Option<&TerrainTile>,
    handle: Option<TileHandle>,
    contain: &dyn Fn(&TerrainTile) -> bool,
    overlaps: &dyn Fn(&TerrainTile) -> bool,
    result: &mut Vec<TileHandle>,
) -> Option<TileHandle> {
    let h = handle?;
    let tile = tile?;

    // Prune: a subtree that cannot spatially overlap the query holds no match.
    if !overlaps(tile) {
        return None;
    }

    let previous_result_len = result.len();

    for child in &tile.children {
        if let Some(v) = traverse_contained_children(
            qt,
            qt.qt.get(*child),
            Some(*child),
            contain,
            overlaps,
            result,
        ) {
            result.push(v);
        }
    }

    if (previous_result_len == result.len()) && contain(tile) {
        return Some(h);
    }

    None
}

#[cfg(test)]
mod test {
    use navara_core::{Angle, LngLat, TileRegion, TileXYZ, TilingScheme};
    use navara_quadtree::Coords;

    use super::{TerrainExaggeration, TerrainTileQuadtree};

    use super::{
        MAX_UPSAMPLE_DEPTH, TerrainTile, TileHandle, UpsampleAncestors, find_contained_child,
    };

    #[test]
    fn get_region_handles_floating_point_drift_on_mid_boundary() {
        // Regression for: geographic grandchildren whose west edge lies exactly
        // on the parent's mid_lng were miscategorised as the WEST child because
        // `f64::EPSILON` is too tight at ~2.4 rad.
        // Parent (29011, 11410, 14) and east children (58023, *, 15) near Mt
        // Fuji from the original bug report.
        // Internal y is XYZ-style (y=0 north). Parent y=11410 at z=14 → child
        // northern row is y=22820, southern row is y=22821.
        let scheme = TilingScheme::Geographic { tms: true };
        let parent = TerrainTile::new_with_scheme(
            TileXYZ {
                x: 29011,
                y: 11410,
                z: 14,
            },
            0.,
            0.,
            scheme.clone(),
        );
        let nw = TerrainTile::new_with_scheme(
            TileXYZ {
                x: 58022,
                y: 22820,
                z: 15,
            },
            0.,
            0.,
            scheme.clone(),
        );
        let ne = TerrainTile::new_with_scheme(
            TileXYZ {
                x: 58023,
                y: 22820,
                z: 15,
            },
            0.,
            0.,
            scheme.clone(),
        );
        let sw = TerrainTile::new_with_scheme(
            TileXYZ {
                x: 58022,
                y: 22821,
                z: 15,
            },
            0.,
            0.,
            scheme.clone(),
        );
        let se = TerrainTile::new_with_scheme(
            TileXYZ {
                x: 58023,
                y: 22821,
                z: 15,
            },
            0.,
            0.,
            scheme,
        );

        assert_eq!(
            nw.region_path_from(&parent),
            Some(vec![TileRegion::NorthWest])
        );
        assert_eq!(
            ne.region_path_from(&parent),
            Some(vec![TileRegion::NorthEast])
        );
        assert_eq!(
            sw.region_path_from(&parent),
            Some(vec![TileRegion::SouthWest])
        );
        assert_eq!(
            se.region_path_from(&parent),
            Some(vec![TileRegion::SouthEast])
        );
    }

    #[test]
    fn get_region_works_for_web_mercator_southern_hemisphere() {
        // Regression for: WebMercator south-hemisphere tiles were misidentified
        // because the projection is non-linear in latitude — the actual child
        // boundary does not sit at the parent's arithmetic mid_lat, so the
        // north child of a southern tile was classified as a south child and
        // raster-DEM upsampling produced incorrect geometry.
        let scheme = TilingScheme::WebMercator { tms: false };
        let parent =
            TerrainTile::new_with_scheme(TileXYZ { x: 1, y: 2, z: 2 }, 0., 0., scheme.clone());
        let nw = TerrainTile::new_with_scheme(TileXYZ { x: 2, y: 4, z: 3 }, 0., 0., scheme.clone());
        let ne = TerrainTile::new_with_scheme(TileXYZ { x: 3, y: 4, z: 3 }, 0., 0., scheme.clone());
        let sw = TerrainTile::new_with_scheme(TileXYZ { x: 2, y: 5, z: 3 }, 0., 0., scheme.clone());
        let se = TerrainTile::new_with_scheme(TileXYZ { x: 3, y: 5, z: 3 }, 0., 0., scheme);

        assert_eq!(
            nw.region_path_from(&parent),
            Some(vec![TileRegion::NorthWest])
        );
        assert_eq!(
            ne.region_path_from(&parent),
            Some(vec![TileRegion::NorthEast])
        );
        assert_eq!(
            sw.region_path_from(&parent),
            Some(vec![TileRegion::SouthWest])
        );
        assert_eq!(
            se.region_path_from(&parent),
            Some(vec![TileRegion::SouthEast])
        );
    }

    fn setup_tile(qt: &mut TerrainTileQuadtree, coords: Coords<usize>) {
        let children = qt.qt.initialize_children(coords, &|v| {
            TerrainTile::new(
                TileXYZ {
                    x: v.0,
                    y: v.1,
                    z: v.2,
                },
                0.,
                0.,
            )
        });
        let tile = qt.qt.get_mut(qt.qt.leaf(coords).unwrap().handle()).unwrap();
        tile.children = children.unwrap();
    }

    #[test]
    fn it_should_find_contained_tile() {
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();

        qt.qt.initialize_zero(&|v| {
            TerrainTile::new(
                TileXYZ {
                    x: v.0,
                    y: v.1,
                    z: v.2,
                },
                0.,
                0.,
            )
        });
        setup_tile(&mut qt, (0, 0, 0));
        setup_tile(&mut qt, (0, 0, 1));
        setup_tile(&mut qt, (1, 0, 1));
        setup_tile(&mut qt, (0, 1, 1));
        setup_tile(&mut qt, (1, 1, 1));

        let point = LngLat {
            lng: Angle::new(2.5),
            lat: Angle::new(1.1),
        };
        let h = find_contained_child(&qt, &|t| t.extent.contains(&point), &|t| {
            t.extent.contains(&point)
        });
        let child = qt.qt.get(h.unwrap());
        assert_eq!(child.unwrap().coords, TileXYZ { x: 3, y: 1, z: 2 });
    }

    #[test]
    fn region_path_walks_every_level_from_the_ancestor() {
        let ancestor = TerrainTile::new(TileXYZ { x: 1, y: 2, z: 2 }, 0., 0.);
        // z=4 tile inside (1,2,2): (1,2)->(3,4) NE child at z=3 -> (6,9) SW child at z=4.
        let tile = TerrainTile::new(TileXYZ { x: 6, y: 9, z: 4 }, 0., 0.);
        assert_eq!(
            tile.region_path_from(&ancestor),
            Some(vec![TileRegion::NorthEast, TileRegion::SouthWest])
        );
    }

    #[test]
    fn region_path_rejects_non_ancestors() {
        let tile = TerrainTile::new(TileXYZ { x: 6, y: 9, z: 4 }, 0., 0.);
        let same_level = TerrainTile::new(TileXYZ { x: 7, y: 9, z: 4 }, 0., 0.);
        let unrelated = TerrainTile::new(TileXYZ { x: 0, y: 0, z: 2 }, 0., 0.);
        let deeper = TerrainTile::new(TileXYZ { x: 12, y: 18, z: 5 }, 0., 0.);
        assert_eq!(tile.region_path_from(&same_level), None);
        assert_eq!(tile.region_path_from(&unrelated), None);
        assert_eq!(tile.region_path_from(&deeper), None);
    }

    fn cached_mesh(with_heights: bool) -> CachedMeshHandle {
        CachedMeshHandle {
            vertices: 0,
            indices: 0,
            uvs: 0,
            heights: with_heights.then_some(0),
            normals: None,
            watermask: None,
        }
    }

    /// z0 root with the whole chain down to (3, 5, 3) initialized.
    /// A tile at `coords` with an empty height range, for the quadtree
    /// initializers.
    fn new_tile((x, y, z): (usize, usize, usize)) -> TerrainTile {
        TerrainTile::new(TileXYZ { x, y, z }, 0., 0.)
    }

    /// A quadtree holding the root and the ancestor chain down to each of
    /// `leaves` (every ancestor on the way is created too).
    fn chain_qt_to(leaves: &[Coords<usize>]) -> TerrainTileQuadtree {
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt.initialize_zero(&new_tile);
        for &coords in leaves {
            qt.qt.initialize_leaf(coords, &new_tile);
        }
        qt
    }

    /// The root → (0,1,1) → (1,2,2) → (3,5,3) chain the source tests walk.
    fn chain_qt() -> TerrainTileQuadtree {
        chain_qt_to(&[(0, 1, 1), (1, 2, 2), (3, 5, 3)])
    }

    /// The straight (0,0,z) chain from the root down to `leaf_z`.
    fn straight_chain_qt(leaf_z: usize) -> TerrainTileQuadtree {
        let leaves: Vec<Coords<usize>> = (1..=leaf_z).map(|z| (0, 0, z)).collect();
        chain_qt_to(&leaves)
    }

    fn set_mesh(
        qt: &mut TerrainTileQuadtree,
        coords: Coords<usize>,
        heights: bool,
        upsampled: bool,
    ) {
        let handle = qt.qt.leaf(coords).unwrap().handle();
        let tile = qt.qt.get_mut(handle).unwrap();
        tile.cached_mesh_handle = Some(cached_mesh(heights));
        tile.upsampled = upsampled;
    }

    fn handle_of(qt: &TerrainTileQuadtree, coords: Coords<usize>) -> TileHandle {
        qt.qt.leaf(coords).unwrap().handle()
    }

    #[test]
    fn upsample_source_prefers_nearest_real_mesh_over_nearer_upsampled_one() {
        let mut qt = chain_qt();
        set_mesh(&mut qt, (0, 0, 0), true, false);
        set_mesh(&mut qt, (0, 1, 1), true, false);
        set_mesh(&mut qt, (1, 2, 2), true, true);
        let leaf = qt.qt.get(handle_of(&qt, (3, 5, 3))).unwrap();
        assert_eq!(
            leaf.find_upsample_source(&qt, |_| false, true, true),
            Some(handle_of(&qt, (0, 1, 1)))
        );
    }

    #[test]
    fn upsample_source_falls_back_to_upsampled_ancestor_only_when_allowed() {
        let mut qt = chain_qt();
        set_mesh(&mut qt, (1, 2, 2), true, true);
        let leaf = qt.qt.get(handle_of(&qt, (3, 5, 3))).unwrap();
        assert_eq!(
            leaf.find_upsample_source(&qt, |_| false, true, true),
            Some(handle_of(&qt, (1, 2, 2)))
        );
        assert_eq!(leaf.find_upsample_source(&qt, |_| false, false, true), None);
    }

    /// A real ancestor exactly `MAX_UPSAMPLE_DEPTH` levels up is a source;
    /// one level farther is not while bounded, and is again when the bound is
    /// lifted (overscale band, failed DEM).
    #[test]
    fn upsample_source_is_bounded_by_max_upsample_depth() {
        let leaf_z = MAX_UPSAMPLE_DEPTH + 1;
        let mut qt = straight_chain_qt(leaf_z);
        let leaf_handle = handle_of(&qt, (0, 0, leaf_z));

        set_mesh(&mut qt, (0, 0, 0), true, false);
        let leaf = qt.qt.get(leaf_handle).unwrap();
        assert_eq!(
            leaf.find_upsample_source(&qt, |_| false, true, true),
            None,
            "a real ancestor {} levels up is too far while bounded",
            leaf_z
        );
        assert_eq!(
            leaf.find_upsample_source(&qt, |_| false, true, false),
            Some(handle_of(&qt, (0, 0, 0))),
            "the bound is lifted where no own DEM will ever land"
        );

        set_mesh(&mut qt, (0, 0, 1), true, false);
        let leaf = qt.qt.get(leaf_handle).unwrap();
        assert_eq!(
            leaf.find_upsample_source(&qt, |_| false, true, true),
            Some(handle_of(&qt, (0, 0, 1))),
            "a real ancestor exactly MAX_UPSAMPLE_DEPTH levels up qualifies"
        );
    }

    /// A nearer upsampled ancestor never stands in for a real one that is out
    /// of bound: its mesh derives from that same real ancestor.
    #[test]
    fn upsample_source_does_not_fall_back_to_upsampled_when_real_is_out_of_bound() {
        let leaf_z = MAX_UPSAMPLE_DEPTH + 1;
        let mut qt = straight_chain_qt(leaf_z);
        set_mesh(&mut qt, (0, 0, 0), true, false);
        set_mesh(&mut qt, (0, 0, leaf_z - 1), true, true);
        let leaf = qt.qt.get(handle_of(&qt, (0, 0, leaf_z))).unwrap();
        assert_eq!(leaf.find_upsample_source(&qt, |_| false, true, true), None);
        assert_eq!(
            leaf.find_upsample_source(&qt, |_| false, true, false),
            Some(handle_of(&qt, (0, 0, 0)))
        );
    }

    /// Record the source level of the mesh `coords` currently shows.
    fn set_upsample_source_z(qt: &mut TerrainTileQuadtree, coords: Coords<usize>, source_z: usize) {
        let handle = handle_of(qt, coords);
        qt.qt.get_mut(handle).unwrap().upsample_source_z = Some(source_z);
    }

    /// Whether the leaf `(0, 0, leaf_z)` of a straight chain is stale, with
    /// `is_final` answering the question the cheaper tests leave open.
    fn leaf_is_stale(
        qt: &TerrainTileQuadtree,
        leaf_z: usize,
        is_final: impl FnOnce(usize) -> bool,
    ) -> bool {
        let leaf = qt.qt.get(handle_of(qt, (0, 0, leaf_z))).unwrap();
        leaf.has_stale_upsample_source(leaf.upsample_ancestors(qt, |_| false), is_final)
    }

    /// A raster-DEM ancestor whose own DEM has landed is a source before its
    /// mesh is built: the worker resamples the DEM bytes, not the mesh.
    #[test]
    fn upsample_source_counts_a_landed_dem_without_a_mesh() {
        let leaf_z = MAX_UPSAMPLE_DEPTH + 1;
        let qt = straight_chain_qt(leaf_z);
        let leaf = qt.qt.get(handle_of(&qt, (0, 0, leaf_z))).unwrap();
        assert_eq!(leaf.find_upsample_source(&qt, |_| false, false, true), None);
        assert_eq!(
            leaf.find_upsample_source(&qt, |t| t.coords.z == 1, false, true),
            Some(handle_of(&qt, (0, 0, 1)))
        );
    }

    /// A mesh clipped from out of bound is stale once a nearer real-data
    /// ancestor brings the tile within the bound, even a single level nearer.
    #[test]
    fn upsample_source_is_stale_once_a_nearer_ancestor_settles_the_tile() {
        let leaf_z = MAX_UPSAMPLE_DEPTH + 2;
        let mut qt = straight_chain_qt(leaf_z);
        set_mesh(&mut qt, (0, 0, 1), true, false);
        set_mesh(&mut qt, (0, 0, leaf_z), true, true);
        set_upsample_source_z(&mut qt, (0, 0, leaf_z), 1);
        assert!(
            !leaf_is_stale(&qt, leaf_z, |_| unreachable!("nothing nearer to ask about")),
            "the source is still the nearest real ancestor there is"
        );

        set_mesh(&mut qt, (0, 0, 2), true, false);
        assert!(leaf_is_stale(&qt, leaf_z, |_| unreachable!(
            "settled without the walk"
        )));
    }

    /// A tile no ancestor can settle yet rebuilds on a jump of at least
    /// `MAX_UPSAMPLE_DEPTH` levels, not on every level the frontier advances.
    #[test]
    fn upsample_source_out_of_bound_rebuilds_on_a_big_enough_jump() {
        let leaf_z = MAX_UPSAMPLE_DEPTH + 4;
        let mut qt = straight_chain_qt(leaf_z);
        set_mesh(&mut qt, (0, 0, 0), true, false);
        set_mesh(&mut qt, (0, 0, leaf_z), true, true);
        set_upsample_source_z(&mut qt, (0, 0, leaf_z), 0);

        set_mesh(&mut qt, (0, 0, 1), true, false);
        assert!(
            !leaf_is_stale(&qt, leaf_z, |_| false),
            "one level nearer is not worth a task while more may follow"
        );

        set_mesh(&mut qt, (0, 0, MAX_UPSAMPLE_DEPTH), true, false);
        assert!(
            leaf_is_stale(&qt, leaf_z, |_| unreachable!("a jump needs no walk")),
            "MAX_UPSAMPLE_DEPTH levels nearer is, though still out of bound"
        );
    }

    /// The last source a tile will ever get is taken however small the step:
    /// nothing better follows, so that level would otherwise separate it from
    /// the best surface for good.
    #[test]
    fn upsample_source_takes_the_final_ancestor_however_small_the_step() {
        let leaf_z = MAX_UPSAMPLE_DEPTH + 4;
        let mut qt = straight_chain_qt(leaf_z);
        set_mesh(&mut qt, (0, 0, 0), true, false);
        set_mesh(&mut qt, (0, 0, 1), true, false);
        set_mesh(&mut qt, (0, 0, leaf_z), true, true);
        set_upsample_source_z(&mut qt, (0, 0, leaf_z), 0);

        assert!(!leaf_is_stale(&qt, leaf_z, |_| false));
        assert!(leaf_is_stale(&qt, leaf_z, |real_z| {
            assert_eq!(real_z, 1, "asked about the nearest real ancestor");
            true
        }));
    }

    /// A tile whose last upsample failed is never flagged: it cannot be
    /// rebuilt by upsampling, so the flag would have no path to consume it.
    #[test]
    fn upsample_source_is_not_stale_when_the_upsample_failed() {
        let leaf_z = MAX_UPSAMPLE_DEPTH + 1;
        let mut qt = straight_chain_qt(leaf_z);
        set_mesh(&mut qt, (0, 0, 0), true, false);
        set_mesh(&mut qt, (0, 0, 1), true, false);
        set_mesh(&mut qt, (0, 0, leaf_z), true, true);
        set_upsample_source_z(&mut qt, (0, 0, leaf_z), 0);
        assert!(leaf_is_stale(&qt, leaf_z, |_| false));

        let leaf_handle = handle_of(&qt, (0, 0, leaf_z));
        qt.qt.get_mut(leaf_handle).unwrap().upsample_failed = true;
        assert!(!leaf_is_stale(&qt, leaf_z, |_| true));
    }

    /// Extending level by level along the path must resolve exactly what the
    /// quadtree walk resolves, at every level.
    #[test]
    fn upsample_ancestors_extended_along_the_path_match_the_walk() {
        let mut qt = chain_qt();
        set_mesh(&mut qt, (0, 0, 0), true, false);
        set_mesh(&mut qt, (0, 1, 1), false, false);
        set_mesh(&mut qt, (1, 2, 2), true, true);
        let path = [(0, 0, 0), (0, 1, 1), (1, 2, 2), (3, 5, 3)];
        // (0, 1, 1) has no mesh with heights; only its landed DEM makes it real.
        for (landed, real) in [(None, (0, 0, 0)), (Some((0, 1, 1)), (0, 1, 1))] {
            let dem_landed = |t: &TerrainTile| landed == Some((t.coords.x, t.coords.y, t.coords.z));
            let mut handed_down = UpsampleAncestors::default();
            for coords in path {
                let handle = handle_of(&qt, coords);
                let tile = qt.qt.get(handle).unwrap();
                assert_eq!(
                    handed_down,
                    tile.upsample_ancestors(&qt, dem_landed),
                    "at {coords:?}"
                );
                handed_down = handed_down.extend_with(tile, handle, dem_landed(tile));
            }
            assert_eq!(handed_down.real, Some((handle_of(&qt, real), real.2)));
            assert_eq!(handed_down.upsampled, Some((handle_of(&qt, (1, 2, 2)), 2)));
        }
    }

    #[test]
    fn upsample_source_ignores_meshes_without_heights() {
        let mut qt = chain_qt();
        // A flat (ellipsoid / failed-without-parent) mesh carries no heights.
        set_mesh(&mut qt, (0, 0, 0), false, false);
        set_mesh(&mut qt, (1, 2, 2), false, false);
        let leaf = qt.qt.get(handle_of(&qt, (3, 5, 3))).unwrap();
        assert_eq!(leaf.find_upsample_source(&qt, |_| false, true, true), None);
    }

    #[test]
    fn find_contained_child_prunes_non_overlapping_subtrees() {
        use std::cell::Cell;

        // z0 root + 4 tiles at z1 + 16 tiles at z2 = 21 tiles total.
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt.initialize_zero(&|v| {
            TerrainTile::new(
                TileXYZ {
                    x: v.0,
                    y: v.1,
                    z: v.2,
                },
                0.,
                0.,
            )
        });
        setup_tile(&mut qt, (0, 0, 0));
        setup_tile(&mut qt, (0, 0, 1));
        setup_tile(&mut qt, (1, 0, 1));
        setup_tile(&mut qt, (0, 1, 1));
        setup_tile(&mut qt, (1, 1, 1));

        let point = LngLat {
            lng: Angle::new(2.5),
            lat: Angle::new(1.1),
        };

        // The pruning predicate skips subtrees whose extent misses the point, so
        // `contain` is evaluated only along the single descent path — never on
        // the 12 z2 tiles in the other three quadrants. Without pruning every
        // tile would be visited.
        let contain_calls = Cell::new(0);
        let overlaps_calls = Cell::new(0);
        let h = find_contained_child(
            &qt,
            &|t| {
                contain_calls.set(contain_calls.get() + 1);
                t.extent.contains(&point)
            },
            &|t| {
                overlaps_calls.set(overlaps_calls.get() + 1);
                t.extent.contains(&point)
            },
        );

        // Same result as the unpruned walk.
        assert_eq!(
            qt.qt.get(h.unwrap()).unwrap().coords,
            TileXYZ { x: 3, y: 1, z: 2 }
        );

        // Only the deepest matching tile reaches `contain` (its overlapping
        // ancestors short-circuit on a child match, its siblings are pruned).
        assert_eq!(contain_calls.get(), 1);
        // Visited tiles stay on the descent path: root + its 4 children + at
        // most the matching child's 4 children = 9 (fewer in practice, as the
        // child loop stops at the first match). Far below the 21 tiles a full,
        // unpruned walk would visit.
        assert!(
            overlaps_calls.get() <= 9,
            "expected pruned visit count, got {}",
            overlaps_calls.get()
        );
    }

    use super::find_terrain_tile_for_extent;
    use navara_mesh::CachedMeshHandle;

    /// Mark a tile as having terrain data and a cached mesh so it's eligible
    /// for `find_terrain_tile_for_extent`.
    fn mark_tile_ready(qt: &mut TerrainTileQuadtree, coords: Coords<usize>) {
        use crate::terrain::RasterDEMData;
        let handle = qt.qt.leaf(coords).unwrap().handle();
        let tile = qt.qt.get_mut(handle).unwrap();
        tile.cached_mesh_handle = Some(CachedMeshHandle {
            vertices: 0,
            indices: 0,
            uvs: 0,
            heights: None,
            normals: None,
            watermask: None,
        });
        tile.terrain_data = Some(Box::new(RasterDEMData::default()));
    }

    fn setup_qt_with_ready_tiles() -> TerrainTileQuadtree {
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt.initialize_zero(&|v| {
            TerrainTile::new(
                TileXYZ {
                    x: v.0,
                    y: v.1,
                    z: v.2,
                },
                0.,
                0.,
            )
        });
        setup_tile(&mut qt, (0, 0, 0));
        setup_tile(&mut qt, (0, 0, 1));
        setup_tile(&mut qt, (1, 0, 1));
        setup_tile(&mut qt, (0, 1, 1));
        setup_tile(&mut qt, (1, 1, 1));
        qt
    }

    /// Like [`mark_tile_ready`], with the loaded mesh's height range.
    fn mark_tile_heights(qt: &mut TerrainTileQuadtree, coords: Coords<usize>, min: f64, max: f64) {
        use crate::terrain::RasterDEMData;
        mark_tile_ready(qt, coords);
        let handle = qt.qt.leaf(coords).unwrap().handle();
        qt.qt.get_mut(handle).unwrap().terrain_data = Some(Box::new(RasterDEMData {
            current_min_height: Some(min),
            current_max_height: Some(max),
            ..Default::default()
        }));
    }

    #[test]
    fn terrain_height_range_reads_every_loaded_level() {
        let mut qt = setup_qt_with_ready_tiles();
        // The parent still renders the three quadrants without a loaded
        // child, and its mesh misses the peak the loaded child reaches.
        mark_tile_heights(&mut qt, (1, 0, 1), -10., 3600.);
        mark_tile_heights(&mut qt, (3, 1, 2), 100., 3800.);
        let extent = qt
            .qt
            .get(qt.qt.leaf((1, 0, 1)).unwrap().handle())
            .unwrap()
            .extent;

        assert_eq!(
            super::terrain_height_range(&qt, &TerrainExaggeration::default(), extent),
            (-10., 3800.)
        );
    }

    #[test]
    fn terrain_height_range_is_exaggerated() {
        let mut qt = setup_qt_with_ready_tiles();
        let extent = qt
            .qt
            .get(qt.qt.leaf((1, 0, 1)).unwrap().handle())
            .unwrap()
            .extent;
        let exaggeration = TerrainExaggeration::new(2., 100.);

        // Before any terrain loads, the flat surface at height 0.
        assert_eq!(
            super::terrain_height_range(&qt, &exaggeration, extent),
            (-100., -100.)
        );

        mark_tile_heights(&mut qt, (1, 0, 1), -10., 3600.);
        assert_eq!(
            super::terrain_height_range(&qt, &exaggeration, extent),
            (-120., 7100.)
        );
    }

    #[test]
    fn find_raster_tile_for_extent_returns_deepest_matching_tile() {
        let mut qt = setup_qt_with_ready_tiles();

        // Mark a z=2 tile as ready (tile 3,1,2 covers roughly east/north quadrant)
        mark_tile_ready(&mut qt, (3, 1, 2));

        let tile_3_1_2 = qt.qt.get(qt.qt.leaf((3, 1, 2)).unwrap().handle()).unwrap();
        let target_extent = tile_3_1_2.extent;

        let result = find_terrain_tile_for_extent(&qt, &target_extent);
        assert!(result.is_some());
        let found = qt.qt.get(result.unwrap()).unwrap();
        assert_eq!(found.coords, TileXYZ { x: 3, y: 1, z: 2 });
    }

    #[test]
    fn find_raster_tile_for_extent_returns_none_when_no_tile_ready() {
        let qt = setup_qt_with_ready_tiles();
        // No tiles are marked ready (no cached_mesh_handle or terrain_data)
        let extent = qt
            .qt
            .get(qt.qt.leaf((3, 1, 2)).unwrap().handle())
            .unwrap()
            .extent;
        let result = find_terrain_tile_for_extent(&qt, &extent);
        assert!(result.is_none());
    }

    #[test]
    fn find_raster_tile_for_extent_skips_upsampled_tiles() {
        let mut qt = setup_qt_with_ready_tiles();
        mark_tile_ready(&mut qt, (3, 1, 2));

        // Mark the tile as upsampled
        let handle = qt.qt.leaf((3, 1, 2)).unwrap().handle();
        qt.qt.get_mut(handle).unwrap().upsampled = true;

        let extent = qt.qt.get(handle).unwrap().extent;
        let result = find_terrain_tile_for_extent(&qt, &extent);
        assert!(result.is_none());
    }

    #[test]
    fn collect_terrain_leaves_returns_ready_tiles() {
        use super::collect_terrain_leaves;

        let mut qt = setup_qt_with_ready_tiles();

        // No tiles ready → empty
        assert!(collect_terrain_leaves(&qt).is_empty());

        // Mark two tiles as ready
        mark_tile_ready(&mut qt, (3, 1, 2));
        mark_tile_ready(&mut qt, (0, 0, 2));

        let leaves = collect_terrain_leaves(&qt);
        assert_eq!(leaves.len(), 2);
    }

    /// Give the tile at `coords` a mesh and the given unexaggerated heights.
    fn mark_tile_height_fields(
        qt: &mut TerrainTileQuadtree,
        coords: Coords<usize>,
        max_height: f64,
        min_height: f64,
    ) {
        mark_tile_ready(qt, coords);
        let t = qt.qt.get_mut(handle_of(qt, coords)).unwrap();
        t.max_height = max_height;
        t.min_height = min_height;
    }

    /// The two Geographic root tiles, without children.
    fn geographic_roots_qt() -> TerrainTileQuadtree {
        let geo = TilingScheme::Geographic { tms: true };
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        for root in geo.root_tiles() {
            qt.qt.initialize_leaf((root.x, root.y, root.z), &|v| {
                TerrainTile::new_with_scheme(
                    TileXYZ {
                        x: v.0,
                        y: v.1,
                        z: v.2,
                    },
                    0.,
                    0.,
                    geo.clone(),
                )
            });
        }
        qt
    }

    #[test]
    fn terrain_height_for_tile_reads_the_same_web_mercator_tile() {
        use super::terrain_height_for_tile;

        let mut qt = setup_qt_with_ready_tiles();
        mark_tile_height_fields(&mut qt, (3, 1, 2), 1500., -20.);

        let coords = TileXYZ { x: 3, y: 1, z: 2 };
        assert_eq!(
            terrain_height_for_tile(&qt, &TerrainExaggeration::default(), coords),
            (1500., -20.)
        );
        assert_eq!(
            terrain_height_for_tile(&qt, &TerrainExaggeration::new(2., 100.), coords),
            (2900., -140.)
        );
    }

    #[test]
    fn terrain_height_for_tile_prefers_the_same_size_tile_over_a_deeper_one() {
        use super::terrain_height_for_tile;

        let mut qt = setup_qt_with_ready_tiles();
        mark_tile_height_fields(&mut qt, (1, 0, 1), 2000., -100.);
        // A child covering only part of (1, 0, 1).
        mark_tile_height_fields(&mut qt, (3, 1, 2), 500., 0.);

        assert_eq!(
            terrain_height_for_tile(
                &qt,
                &TerrainExaggeration::default(),
                TileXYZ { x: 1, y: 0, z: 1 }
            ),
            (2000., -100.)
        );
    }

    #[test]
    fn terrain_height_for_tile_falls_back_to_the_nearest_ancestor_with_a_mesh() {
        use super::terrain_height_for_tile;

        let mut qt = setup_qt_with_ready_tiles();
        mark_tile_height_fields(&mut qt, (1, 0, 1), 2000., -100.);

        // (3, 1, 2) exists without a mesh; (13, 5, 4) and its parent do not exist.
        for coords in [TileXYZ { x: 3, y: 1, z: 2 }, TileXYZ { x: 13, y: 5, z: 4 }] {
            assert_eq!(
                terrain_height_for_tile(&qt, &TerrainExaggeration::default(), coords),
                (2000., -100.)
            );
        }
    }

    #[test]
    fn terrain_height_for_tile_flat_surface_without_ready_terrain() {
        use super::terrain_height_for_tile;

        let qt = setup_qt_with_ready_tiles();
        let coords = TileXYZ { x: 3, y: 1, z: 2 };
        assert_eq!(
            terrain_height_for_tile(&qt, &TerrainExaggeration::default(), coords),
            (0., 0.)
        );
        // Scale 5 around 2000 m moves height 0 to -8000 m.
        assert_eq!(
            terrain_height_for_tile(&qt, &TerrainExaggeration::new(5., 2000.), coords),
            (-8000., -8000.)
        );
    }

    /// A WebMercator tile has no twin in a Geographic quadtree: it reads the
    /// Geographic tiles of its size, here falling back to the eastern root.
    #[test]
    fn terrain_height_for_tile_reads_geographic_terrain() {
        use super::terrain_height_for_tile;

        let mut qt = geographic_roots_qt();
        // East root (1,0,0) covers lng 0..180°, lat -90..90°.
        mark_tile_height_fields(&mut qt, (1, 0, 0), 3776., 0.);

        // Centred around 102°E, 11°N.
        assert_eq!(
            terrain_height_for_tile(
                &qt,
                &TerrainExaggeration::default(),
                TileXYZ {
                    x: 200,
                    y: 120,
                    z: 8
                }
            ),
            (3776., 0.)
        );
    }

    #[test]
    fn terrain_height_for_tile_spans_geographic_rows() {
        use super::terrain_height_for_tile;

        let mut qt = geographic_roots_qt();
        setup_geographic_tile(&mut qt, (1, 0, 0));
        setup_geographic_tile(&mut qt, (2, 0, 1));
        // Geographic level 2 rows are 45° tall: (5, 0, 2) covers lat 45..90°N
        // and (5, 1, 2) lat 0..45°N, both lng 45..90°E.
        mark_tile_height_fields(&mut qt, (5, 0, 2), 3000., 100.);
        mark_tile_height_fields(&mut qt, (5, 1, 2), 800., -50.);

        // WebMercator (5, 2, 3) covers lng 45..90°E, lat ~41..67°N.
        assert_eq!(
            terrain_height_for_tile(
                &qt,
                &TerrainExaggeration::default(),
                TileXYZ { x: 5, y: 2, z: 3 }
            ),
            (3000., -50.)
        );
    }

    /// Initialize a leaf with the Geographic tiling scheme so its extent and
    /// children match EPSG:4326 layout.
    fn setup_geographic_tile(qt: &mut TerrainTileQuadtree, coords: Coords<usize>) {
        let scheme = TilingScheme::Geographic { tms: true };
        let children = qt.qt.initialize_children(coords, &|v| {
            TerrainTile::new_with_scheme(
                TileXYZ {
                    x: v.0,
                    y: v.1,
                    z: v.2,
                },
                0.,
                0.,
                scheme.clone(),
            )
        });
        let tile = qt.qt.get_mut(qt.qt.leaf(coords).unwrap().handle()).unwrap();
        tile.children = children.unwrap();
    }

    /// Geographic has two roots — `(0,0,0)` covers the western hemisphere and
    /// `(1,0,0)` covers the eastern. Both find helpers must traverse both.
    #[test]
    fn find_helpers_traverse_both_geographic_roots() {
        use super::collect_terrain_leaves;

        let scheme = TilingScheme::Geographic { tms: true };
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();

        for root in scheme.root_tiles() {
            qt.qt.initialize_leaf((root.x, root.y, root.z), &|v| {
                TerrainTile::new_with_scheme(
                    TileXYZ {
                        x: v.0,
                        y: v.1,
                        z: v.2,
                    },
                    0.,
                    0.,
                    TilingScheme::Geographic { tms: true },
                )
            });
        }

        setup_geographic_tile(&mut qt, (0, 0, 0)); // west root children
        setup_geographic_tile(&mut qt, (1, 0, 0)); // east root children

        // Mark one tile under each root as ready — collect_terrain_leaves uses
        // find_contained_children internally and must see both.
        mark_tile_ready(&mut qt, (0, 0, 1));
        mark_tile_ready(&mut qt, (2, 1, 1));

        let leaves = collect_terrain_leaves(&qt);
        assert_eq!(leaves.len(), 2, "should collect tiles from both roots");

        // find_contained_child for a point inside (2,1,1) — under the east
        // root — must descend into the (1,0,0) subtree, not give up because
        // the west root (0,0,0) misses. Internal y is XYZ-style, so at z=1
        // (2,1,1) covers lng 0°..90°, lat -90°..0°.
        let east_point = LngLat {
            lng: Angle::new(1.0), // ~57°E
            lat: Angle::new(-0.5),
        };
        let east_handle = find_contained_child(
            &qt,
            &|t| t.extent.contains(&east_point) && t.cached_mesh_handle.is_some(),
            &|t| t.extent.contains(&east_point),
        );
        let east_tile = qt.qt.get(east_handle.unwrap()).unwrap();
        assert_eq!(east_tile.coords, TileXYZ { x: 2, y: 1, z: 1 });
    }
}

#[cfg(test)]
mod terrain_tile_tests {
    use super::*;
    use bevy_app::{App, Update};
    use bevy_ecs::prelude::{Entity, Resource};
    use bevy_ecs::system::{Query, ResMut};
    use navara_buffer_store::Handle;
    use navara_component::Order;
    use navara_core::TileXYZ;
    use navara_data_requester::{DataRequester, DataRequesterExtension, DataRequesterStatus};
    use navara_material::{Appearance, HillshadeConfig, RasterMaterial};
    use navara_texture_fragment::{TextureFragment, TextureFragmentStatus};

    use crate::raster_tile_texture_fragment::TileTextureFragmentMarker;

    // ---- shared fixtures ----

    // Zoom now lives on the source; these readiness tests don't exercise zoom
    // ranges (regular-only tiles short-circuit; hillshade cases supply entities),
    // so the zoom args are unused and the harness uses an empty `SourceStore`.
    fn regular_layer(id: &str, _min_zoom: usize, _max_zoom: usize) -> TilesLayer {
        TilesLayer {
            layer_id: id.into(),
            source_id: None,
            appearance: Some(Appearance::TerrainTile(RasterMaterial::default())),
            elevation_heatmap_config: None,
            hillshade_config: None,
        }
    }

    fn hillshade_layer(id: &str, _min_zoom: usize, _max_zoom: usize) -> TilesLayer {
        TilesLayer {
            layer_id: id.into(),
            source_id: None,
            appearance: Some(Appearance::TerrainTile(RasterMaterial::default())),
            elevation_heatmap_config: None,
            hillshade_config: Some(HillshadeConfig { exaggeration: 1.0 }),
        }
    }

    fn texture_fragment(status: TextureFragmentStatus) -> TextureFragment {
        TextureFragment {
            url: "https://example.com/.png".into(),
            status,
        }
    }

    fn data_requester(status: DataRequesterStatus) -> DataRequester {
        DataRequester {
            handle: 0 as Handle,
            url: "https://example.com/.png".into(),
            extension: DataRequesterExtension::Png,
            status,
            managed_by_data_manager: false,
            byte_range: None,
            request_vertex_normals: false,
            request_water_mask: false,
            token: None,
        }
    }

    // ---- is_hillshade_ready ----

    mod is_hillshade_ready {
        use super::*;

        /// Returns `is_hillshade_ready` for a tile at z=5, given the layer fixture and
        /// closures that produce the entity-id arrays. The setup callback receives
        /// the world so it can spawn entities and reference their IDs.
        fn run<F>(layers: Vec<(TilesLayer, Order)>, setup: F) -> bool
        where
            F: FnOnce(&mut bevy_ecs::world::World) -> (Vec<Option<Entity>>, Vec<Option<Entity>>),
        {
            let mut app = App::new();
            for (layer, order) in layers {
                app.world_mut().spawn((layer, order));
            }
            let (_tex_ids, hill_ids) = setup(app.world_mut());

            #[derive(Resource, Default)]
            struct Out(Option<bool>);
            app.init_resource::<Out>();

            let hill_ids = std::sync::Mutex::new(Some(hill_ids));
            app.add_systems(
                Update,
                move |data_requesters: Query<&DataRequester>,
                      tiles: Query<(&TilesLayer, &Order)>,
                      mut out: ResMut<Out>| {
                    let mut tile = TerrainTile::new(TileXYZ { x: 0, y: 0, z: 5 }, 0., 0.);
                    tile.hillshade_entity_ids = Some(hill_ids.lock().unwrap().take().unwrap());
                    let source_store = navara_source::SourceStore::new();
                    let sorted_layers: Vec<_> = tiles.iter().sort::<&Order>().collect();
                    out.0 = Some(tile.is_hillshade_ready(
                        &data_requesters,
                        &sorted_layers,
                        &source_store,
                    ));
                },
            );
            app.update();
            app.world().resource::<Out>().0.unwrap()
        }

        /// Regular (texture) layers no longer gate terrain-side texture
        /// readiness: they are owned by the raster pipeline and pulled
        /// separately (with ancestor fallback). A regular-only tile is therefore
        /// texture-ready regardless of its (now unused) terrain texture slots.
        #[test]
        fn regular_layers_do_not_gate_texture_readiness() {
            let ready = run(
                vec![
                    (regular_layer("a", 0, 20), Order(0)),
                    (regular_layer("b", 0, 20), Order(1)),
                ],
                |_world| {
                    // No terrain-owned texture entities: regular textures are
                    // the raster pipeline's responsibility now.
                    (vec![None, None], vec![None, None])
                },
            );

            assert!(
                ready,
                "regular-only tile is texture-ready (terrain gating is hillshade-only)"
            );
        }

        /// A None slot for a layer that's outside its configured zoom range must be
        /// treated as ready — no entity will ever be requested for that layer.
        #[test]
        fn none_slot_on_out_of_zoom_layer_is_ready() {
            let ready = run(
                // Layer 1's min_zoom=10 → out of range for the test tile at z=5.
                vec![
                    (regular_layer("a", 0, 20), Order(0)),
                    (regular_layer("b", 10, 20), Order(1)),
                ],
                |world| {
                    let e0 = world
                        .spawn((
                            TileTextureFragmentMarker(0),
                            texture_fragment(TextureFragmentStatus::Success),
                        ))
                        .id();
                    (vec![Some(e0), None], vec![None, None])
                },
            );

            assert!(
                ready,
                "None slot for out-of-zoom layer must be treated as ready"
            );
        }

        /// A tile with only hillshade layers must become ready as soon as the
        /// hillshade DataRequester succeeds, reading from `hillshade_entity_ids`.
        #[test]
        fn hillshade_only_tile_is_ready_when_hill_array_has_succeeded_entity() {
            let ready = run(vec![(hillshade_layer("h", 0, 20), Order(0))], |world| {
                let h0 = world
                    .spawn((
                        TileTextureFragmentMarker(0),
                        data_requester(DataRequesterStatus::Success),
                    ))
                    .id();
                (vec![None], vec![Some(h0)])
            });

            assert!(
                ready,
                "hillshade-only tile must read entity from hillshade_entity_ids"
            );
        }

        /// A pending regular layer must NOT block terrain readiness: regular
        /// textures are pulled from the raster pipeline, so terrain-side texture
        /// readiness depends only on the hillshade layer here.
        #[test]
        fn pending_regular_does_not_block_when_hillshade_ready() {
            let ready = run(
                vec![
                    (regular_layer("a", 0, 20), Order(0)),
                    (hillshade_layer("h", 0, 20), Order(1)),
                ],
                |world| {
                    let h1 = world
                        .spawn((
                            TileTextureFragmentMarker(0),
                            data_requester(DataRequesterStatus::Success),
                        ))
                        .id();
                    // Regular slot stays None (raster's job); only the hillshade
                    // entity gates terrain readiness.
                    (vec![None, None], vec![None, Some(h1)])
                },
            );

            assert!(
                ready,
                "pending regular must not block; terrain gating is hillshade-only"
            );
        }
    }

    // ---- is_ready (full terrain readiness) ----

    mod is_ready {
        use super::*;
        use crate::terrain::RasterDEMData;
        use crate::terrain_data_requester::TerrainDataRequesterMarker;
        use navara_layer::TerrainDataType;
        use navara_material::TerrainMaterial;
        use navara_mesh::CachedMeshHandle;

        #[derive(Default)]
        struct ReadyStateSnapshot {
            is_tile_ready: bool,
            is_terrain_ready: bool,
            is_upsamplable: bool,
        }

        /// Test scenario for `is_ready`. The child tile is at z=1 so its parent is
        /// the root tile (z=0), which we configure via `parent_terrain_ready`.
        struct Scenario {
            /// Status of self's DEM request. `None` means no requester is attached.
            self_dem_status: Option<DataRequesterStatus>,
            /// If true, root tile gets terrain_data (Success requester) + cached mesh.
            parent_terrain_ready: bool,
            /// Terrain layer config.
            terrain_max_zoom: usize,
            terrain_overscaled_max_zoom: usize,
            /// The child's own children were activated last frame (zoom-out).
            were_children_rendered: bool,
        }

        fn terrain_layer_with() -> TerrainLayer {
            // Zoom config now lives on the source (see `terrain_source`); the
            // material is render-only.
            TerrainLayer {
                layer_id: "terrain".into(),
                source_id: Some("terrain".into()),
                terrain_type: TerrainDataType::RasterDEM,
                appearance: Some(TerrainMaterial::default()),
            }
        }

        fn terrain_source(max_zoom: usize, overscaled_max_zoom: usize) -> navara_source::Source {
            navara_source::Source::RasterDem(navara_source::RasterDemSource {
                source_id: "terrain".into(),
                url: "https://example.com/{z}/{x}/{y}.png".into(),
                tms: false,
                elevation_decoder: Default::default(),
                tile_size: 256,
                min_zoom: 0,
                max_zoom,
                overscaled_max_zoom,
            })
        }

        fn run(scenario: Scenario) -> ReadyStateSnapshot {
            let mut app = App::new();
            app.world_mut().spawn(terrain_layer_with());
            let mut source_store = navara_source::SourceStore::new();
            source_store.add(
                "terrain".into(),
                terrain_source(
                    scenario.terrain_max_zoom,
                    scenario.terrain_overscaled_max_zoom,
                ),
            );

            // Build qt with the root (parent of z=1). Optionally make it terrain-ready.
            let mut qt = TerrainTileQuadtree::new_with_linear_qt();
            qt.qt.initialize_zero(&|v| {
                TerrainTile::new(
                    TileXYZ {
                        x: v.0,
                        y: v.1,
                        z: v.2,
                    },
                    0.,
                    0.,
                )
            });

            if scenario.parent_terrain_ready {
                let root_handle = qt.qt.zero().unwrap().handle();
                let parent_req = app
                    .world_mut()
                    .spawn((
                        TerrainDataRequesterMarker(root_handle),
                        data_requester(DataRequesterStatus::Success),
                    ))
                    .id();
                let root = qt.qt.get_mut(root_handle).unwrap();
                root.terrain_data = Some(Box::new(RasterDEMData {
                    data_requester_entity_id: Some(parent_req),
                    ..Default::default()
                }));
                root.cached_mesh_handle = Some(CachedMeshHandle {
                    vertices: 0,
                    indices: 0,
                    uvs: 0,
                    heights: Some(0),
                    normals: None,
                    watermask: None,
                });
            }

            // Build the child tile (standalone — is_ready doesn't require it in qt).
            let mut child = TerrainTile::new(TileXYZ { x: 0, y: 0, z: 1 }, 0., 0.);
            child.were_children_rendered = scenario.were_children_rendered;
            if let Some(status) = scenario.self_dem_status {
                // child_handle is irrelevant; we just need an entity carrying the
                // marker + DataRequester components.
                let child_req = app
                    .world_mut()
                    .spawn((
                        TerrainDataRequesterMarker(qt.qt.zero().unwrap().handle()),
                        data_requester(status),
                    ))
                    .id();
                child.terrain_data = Some(Box::new(RasterDEMData {
                    data_requester_entity_id: Some(child_req),
                    ..Default::default()
                }));
            }

            app.world_mut().insert_resource(qt);

            #[derive(Resource, Default)]
            struct Out(Option<ReadyStateSnapshot>);
            app.init_resource::<Out>();

            let child = std::sync::Mutex::new(Some(child));
            let source_store = std::sync::Mutex::new(Some(source_store));
            app.add_systems(
                Update,
                move |qt: bevy_ecs::system::Res<TerrainTileQuadtree>,
                      data_requesters: Query<&DataRequester>,
                      terrain_data_requester: crate::TileTerrainDataRequesterQuery,
                      terrain_layers: Query<&TerrainLayer>,
                      tiles: Query<(&TilesLayer, &Order)>,
                      mut out: ResMut<Out>| {
                    let terrain_layer = terrain_layers.iter().next();
                    let child = child.lock().unwrap().take().unwrap();
                    let source_store = source_store.lock().unwrap().take().unwrap();
                    let sorted_layers: Vec<_> = tiles.iter().sort::<&Order>().collect();
                    let rs = child.is_ready(
                        child.upsample_ancestors(&qt, |t| {
                            t.is_terrain_ready(&terrain_data_requester)
                        }),
                        &data_requesters,
                        &terrain_data_requester,
                        &terrain_layer,
                        &sorted_layers,
                        &source_store,
                    );
                    out.0 = Some(ReadyStateSnapshot {
                        is_tile_ready: rs.is_tile_ready,
                        is_terrain_ready: rs.is_terrain_ready,
                        is_upsamplable: rs.is_upsamplable,
                    });
                },
            );
            app.update();
            app.world_mut().resource_mut::<Out>().0.take().unwrap()
        }

        /// Fail at z < max_zoom with a ready parent: tile must become ready and route
        /// through the upsample path (the bug this commit fixes).
        #[test]
        fn marks_tile_ready_on_fail_when_parent_terrain_ready() {
            let rs = run(Scenario {
                self_dem_status: Some(DataRequesterStatus::Fail),
                parent_terrain_ready: true,
                terrain_max_zoom: 20,
                terrain_overscaled_max_zoom: 24,
                were_children_rendered: false,
            });
            assert!(rs.is_tile_ready, "Fail with ready parent must be ready");
            assert!(
                rs.is_upsamplable,
                "Fail with ready parent must take the upsample path"
            );
            assert!(
                !rs.is_terrain_ready,
                "is_terrain_ready stays narrow: own DEM not Success"
            );
        }

        /// Own DEM loaded: never routed through the upsample path.
        #[test]
        fn success_is_terrain_ready_not_upsamplable() {
            let rs = run(Scenario {
                self_dem_status: Some(DataRequesterStatus::Success),
                parent_terrain_ready: true,
                terrain_max_zoom: 20,
                terrain_overscaled_max_zoom: 24,
                were_children_rendered: false,
            });
            assert!(rs.is_tile_ready);
            assert!(rs.is_terrain_ready);
            assert!(!rs.is_upsamplable);
        }

        /// Fail with no parent terrain: last-resort flat fallback (own ready but not
        /// upsamplable).
        #[test]
        fn falls_back_to_flat_when_fail_and_no_parent() {
            let rs = run(Scenario {
                self_dem_status: Some(DataRequesterStatus::Fail),
                parent_terrain_ready: false,
                terrain_max_zoom: 20,
                terrain_overscaled_max_zoom: 24,
                were_children_rendered: false,
            });
            assert!(
                rs.is_tile_ready,
                "Fail must still mark ready for flat fallback"
            );
            assert!(
                !rs.is_upsamplable,
                "No parent terrain → not upsamplable; downstream will render flat"
            );
        }

        /// Regression guard for the upsample band (max_zoom < z <= overscaled_max_zoom)
        /// with a ready parent: should still upsample without needing a Fail status.
        #[test]
        fn in_upsample_band_unchanged() {
            let rs = run(Scenario {
                // No requester at all — upsample band doesn't fetch DEM.
                self_dem_status: None,
                parent_terrain_ready: true,
                terrain_max_zoom: 0,
                terrain_overscaled_max_zoom: 5,
                were_children_rendered: false,
            });
            assert!(
                rs.is_tile_ready,
                "Upsample band with ready parent must be ready"
            );
            assert!(rs.is_upsamplable, "Upsample band must take upsample path");
        }

        /// Pending request with a ready ancestor: upsample-first renders the
        /// ancestor's data now and swaps in the real DEM when it lands.
        #[test]
        fn pending_with_ready_ancestor_upsamples() {
            let rs = run(Scenario {
                self_dem_status: Some(DataRequesterStatus::Pending),
                parent_terrain_ready: true,
                terrain_max_zoom: 20,
                terrain_overscaled_max_zoom: 24,
                were_children_rendered: false,
            });
            assert!(
                rs.is_tile_ready,
                "Pending with ready ancestor renders upsampled"
            );
            assert!(rs.is_upsamplable);
            assert!(!rs.is_terrain_ready);
        }

        /// Pending with nothing to upsample from: still waiting on the fetch.
        #[test]
        fn pending_without_ancestor_is_not_ready() {
            let rs = run(Scenario {
                self_dem_status: Some(DataRequesterStatus::Pending),
                parent_terrain_ready: false,
                terrain_max_zoom: 20,
                terrain_overscaled_max_zoom: 24,
                were_children_rendered: false,
            });
            assert!(!rs.is_tile_ready, "Pending must not be marked ready");
            assert!(!rs.is_upsamplable);
        }

        /// Never requested yet, ancestor ready: the tile renders upsampled first
        /// and the traversal defers the fetch until it settles as the SSE leaf.
        #[test]
        fn unrequested_with_ready_ancestor_upsamples() {
            let rs = run(Scenario {
                self_dem_status: None,
                parent_terrain_ready: true,
                terrain_max_zoom: 20,
                terrain_overscaled_max_zoom: 24,
                were_children_rendered: false,
            });
            assert!(rs.is_tile_ready);
            assert!(rs.is_upsamplable);
        }

        /// Zoom-out: the tile's children are on screen with finer data than any
        /// ancestor, so it does not upsample and waits for its own DEM instead.
        #[test]
        fn zoom_out_waits_for_own_dem_instead_of_upsampling() {
            let rs = run(Scenario {
                self_dem_status: Some(DataRequesterStatus::Pending),
                parent_terrain_ready: true,
                terrain_max_zoom: 20,
                terrain_overscaled_max_zoom: 24,
                were_children_rendered: true,
            });
            assert!(
                !rs.is_tile_ready,
                "children on screen: wait for the real DEM"
            );
            assert!(!rs.is_upsamplable);
        }

        /// In the overscale band no DEM will ever arrive, so zoom-out still
        /// upsamples rather than waiting forever.
        #[test]
        fn zoom_out_in_overscale_band_still_upsamples() {
            let rs = run(Scenario {
                self_dem_status: None,
                parent_terrain_ready: true,
                terrain_max_zoom: 0,
                terrain_overscaled_max_zoom: 5,
                were_children_rendered: true,
            });
            assert!(rs.is_tile_ready);
            assert!(rs.is_upsamplable);
        }

        /// A failed request is never retried, so zoom-out onto a Fail tile
        /// upsamples too instead of waiting for a DEM that will never land.
        #[test]
        fn zoom_out_on_failed_dem_still_upsamples() {
            let rs = run(Scenario {
                self_dem_status: Some(DataRequesterStatus::Fail),
                parent_terrain_ready: true,
                terrain_max_zoom: 20,
                terrain_overscaled_max_zoom: 24,
                were_children_rendered: true,
            });
            assert!(rs.is_tile_ready);
            assert!(rs.is_upsamplable);
        }
    }
}

#[cfg(test)]
mod polar_bounds_tests {
    use super::*;
    use navara_core::{Angle, LLE, Meters, xyz_to_vec3};

    #[test]
    fn bounds_keep_caps_after_dem_height_updates() {
        for tms in [false, true] {
            for (y, latitude) in [(0, 90_f64), (7, -90_f64)] {
                let mut tile = TerrainTile::new_with_scheme(
                    TileXYZ { x: 3, y, z: 3 },
                    1000.,
                    200.,
                    TilingScheme::WebMercator { tms },
                );
                let original_extent = tile.extent;
                let pole = xyz_to_vec3(
                    LLE {
                        lng: Angle::new(0.),
                        lat: Angle::new(latitude.to_radians()),
                        height: Meters::new(0.),
                    }
                    .to_xyz(WGS84_64),
                );
                for (max, min) in [(1000., 200.), (500., 100.), (-100., -500.)] {
                    tile.update_heights(max, min);
                    assert!(tile.aabb.distance_to_point(pole) < 1e-8);
                    let region = tile.bounding_region.as_ref().unwrap();
                    assert_eq!(region.minimum_height, min.min(0.));
                    assert_eq!(region.maximum_height, max.max(0.));
                    let camera_lle = LLE {
                        lng: (original_extent.west + original_extent.east) * 0.5,
                        lat: Angle::new((latitude.signum() * 89.9).to_radians()),
                        height: Meters::new(2000.),
                    };
                    let distance = region
                        .distance_to_camera(xyz_to_vec3(camera_lle.to_xyz(WGS84_64)), camera_lle);
                    assert!((distance - (2000. - max.max(0.))).abs() < 1e-6);
                    assert_eq!(tile.extent, original_extent);
                }
            }
        }
    }

    #[test]
    fn geographic_and_interior_tiles_keep_their_extents() {
        for scheme in [
            TilingScheme::Geographic { tms: false },
            TilingScheme::WebMercator { tms: true },
        ] {
            let tile = TerrainTile::new_with_scheme(
                TileXYZ { x: 1, y: 1, z: 2 },
                100.,
                10.,
                scheme.clone(),
            );
            let sides = PoleSides::from_extent(&scheme, &tile.extent);
            assert_eq!(sides, PoleSides::default());
            assert_eq!(tile.bounding_region.unwrap().extent, tile.extent);
        }
        let e = TilingScheme::Geographic { tms: false }.tile_extent(TileXYZ { x: 0, y: 0, z: 0 });
        assert_eq!(
            PoleSides::from_extent(&TilingScheme::Geographic { tms: false }, &e),
            PoleSides::default()
        );
    }
}

#[cfg(test)]
mod exaggeration_bounds_tests {
    use super::*;

    fn assert_aabb_eq(a: &Aabb, b: &Aabb) {
        assert_eq!(a.center, b.center);
        assert_eq!(a.extents, b.extents);
    }

    fn interior_tile() -> TerrainTile {
        TerrainTile::new_with_scheme(
            TileXYZ { x: 1, y: 1, z: 2 },
            1000.,
            -100.,
            TilingScheme::WebMercator { tms: false },
        )
    }

    #[test]
    fn bounds_use_exaggerated_heights_and_keep_raw_heights() {
        let mut tile = interior_tile();
        tile.occludee_point_in_scaled_space = Some(Vec3::ONE);

        tile.set_exaggeration(TerrainExaggeration::new(3., 0.));

        let region = tile.bounding_region.as_ref().unwrap();
        assert_eq!(region.maximum_height, 3000.);
        assert_eq!(region.minimum_height, -300.);
        assert_eq!(tile.max_height, 1000.);
        assert_eq!(tile.min_height, -100.);
        assert_eq!(tile.max_height(), 1000.);
        assert!(tile.occludee_point_in_scaled_space.is_none());
        assert_aabb_eq(
            &tile.aabb,
            &Aabb::from_extent_f64(tile.extent, -300., 3000.),
        );
    }

    #[test]
    fn height_updates_keep_the_current_exaggeration() {
        let mut tile = interior_tile();
        tile.set_exaggeration(TerrainExaggeration::new(2., 500.));

        tile.update_heights(2500., 0.);

        let region = tile.bounding_region.as_ref().unwrap();
        assert_eq!(region.maximum_height, 4500.);
        assert_eq!(region.minimum_height, -500.);
    }

    #[test]
    fn unchanged_exaggeration_keeps_the_occludee_point() {
        let mut tile = interior_tile();
        tile.set_exaggeration(TerrainExaggeration::new(2., 0.));
        tile.occludee_point_in_scaled_space = Some(Vec3::ONE);

        tile.set_exaggeration(TerrainExaggeration::new(2., 0.));

        assert_eq!(tile.occludee_point_in_scaled_space, Some(Vec3::ONE));
    }

    #[test]
    fn polar_bounds_include_the_displaced_cap() {
        let mut tile = TerrainTile::new_with_scheme(
            TileXYZ { x: 3, y: 0, z: 3 },
            1000.,
            200.,
            TilingScheme::WebMercator { tms: false },
        );

        tile.set_exaggeration(TerrainExaggeration::new(2., 1000.));

        // The cap at height 0 is displaced to (0 - 1000) * 2 + 1000 = -1000.
        let region = tile.bounding_region.as_ref().unwrap();
        assert_eq!(region.minimum_height, -1000.);
        assert_eq!(region.maximum_height, 1000.);
        let sse_region = tile.sse_bounding_region.as_ref().unwrap();
        assert_eq!(sse_region.minimum_height, -600.);
        assert_eq!(sse_region.maximum_height, 1000.);
    }

    #[test]
    fn mesh_bounds_stay_unexaggerated() {
        let mut tile = interior_tile();
        tile.set_exaggeration(TerrainExaggeration::new(3., 0.));

        let bounds = tile.mesh_bounds(-100., 1000.);
        assert_aabb_eq(
            &bounds.aabb,
            &Aabb::from_extent_f64(tile.extent, -100., 1000.),
        );
        assert_eq!((bounds.min_height, bounds.max_height), (-100., 1000.));
    }

    #[test]
    fn polar_mesh_bounds_span_the_cap() {
        let tile = TerrainTile::new_with_scheme(
            TileXYZ { x: 3, y: 0, z: 3 },
            1000.,
            200.,
            TilingScheme::WebMercator { tms: false },
        );

        let bounds = tile.mesh_bounds(200., 1000.);
        assert_eq!((bounds.min_height, bounds.max_height), (0., 1000.));
    }

    /// A sea-level tile 313-470 km east of a camera 3 km above the equator
    /// lies past the ellipsoid's horizon (~196 km). Sinking the sea to
    /// -8000 m (scale 5 around 2000 m) brings it inside the horizon of the
    /// sunken surface (~374 km), so it must no longer be horizon-culled.
    #[test]
    fn sunken_terrain_is_not_hidden_by_the_ellipsoid() {
        use navara_core::{Angle, LLE, Meters, xyz_to_vec3};
        use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;

        let camera = LLE {
            lng: Angle::new(0.),
            lat: Angle::new(0.),
            height: Meters::new(3000.),
        }
        .to_xyz(WGS84_64);
        let occluder = EllipsoidalOccluder::new(&xyz_to_vec3(camera), WGS84_64);
        let mut tile = TerrainTile::new_with_scheme(
            TileXYZ {
                x: 130,
                y: 127,
                z: 8,
            },
            0.,
            0.,
            TilingScheme::WebMercator { tms: false },
        );

        tile.update_tile_occludee_point(&WGS84_64, &occluder);
        assert!(tile.is_occluded_by_horizon(&occluder));

        tile.set_exaggeration(TerrainExaggeration::new(5., 2000.));
        tile.update_tile_occludee_point(&WGS84_64, &occluder);
        assert!(!tile.is_occluded_by_horizon(&occluder));
    }
}
