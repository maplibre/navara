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
use navara_quadtree::Coords;

use crate::{
    HillshadeCancelRequested, TerrainTileQuadtree, Tile, TileHandle, terrain::TerrainData,
    terrain_data_requester::TileTerrainDataRequesterQuery,
};

use navara_layer::{TerrainLayer, TilesLayer};
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
    pub rendered_at: usize,
    pub visited_at: usize,
    pub terrain_data: Option<Box<dyn TerrainData>>,
    pub hillshade_entity_ids: Option<Vec<Option<Entity>>>,
    pub occludee_point_in_scaled_space: Option<Vec3>,
    pub cached_mesh_handle: Option<CachedMeshHandle>,
    /// Whether it's upsampled tile or not.
    pub upsampled: bool,
    pub max_height: f64,
    pub min_height: f64,
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
            rendered_at: self.rendered_at,
            visited_at: self.visited_at,
            terrain_data: self.terrain_data.as_ref().map(|t| t.box_clone()),
            hillshade_entity_ids: self.hillshade_entity_ids.clone(),
            occludee_point_in_scaled_space: self.occludee_point_in_scaled_space,
            cached_mesh_handle: self.cached_mesh_handle.clone(),
            upsampled: self.upsampled,
            max_height: self.max_height,
            min_height: self.min_height,
            distance_from_camera: 0.,
            sse: 0.,
            tiling_scheme: self.tiling_scheme.clone(),
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
        let (bounds_min, bounds_max) = sides.height_range(min_height, max_height);

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
            rendered_at: 0,
            visited_at: 0,
            terrain_data: None,
            hillshade_entity_ids: None,
            occludee_point_in_scaled_space: None,
            cached_mesh_handle: None,
            upsampled: false,
            children: Vec::with_capacity(4),
            were_children_rendered: false,
            max_height,
            min_height,
            distance_from_camera: 0.,
            sse: 0.,
            tiling_scheme,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn is_ready(
        &self,
        qt: &TerrainTileQuadtree,
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

        let should_upsample = terrain_source.is_some_and(|s| s.should_overscale(self.coords.z));
        let is_upsamplable = self.is_upsamplable(qt, terrain_data_requester, terrain_layer);
        let is_in_upsample_band = should_upsample && is_upsamplable;

        let is_terrain_failed = matches!(
            self.get_terrain_data_requester(terrain_data_requester)
                .map(|t| t.status),
            Some(DataRequesterStatus::Fail)
        );
        // Fail + parent ready: upsample from parent instead of rendering flat.
        let can_upsample_failed = is_terrain_failed && is_upsamplable;
        // Last-resort flat fallback: failed and no parent terrain to upsample from.
        let should_be_rendered_without_terrain = is_terrain_failed && !is_upsamplable;

        ReadyState {
            is_tile_ready: is_terrain_ready
                || is_in_upsample_band
                || can_upsample_failed
                || should_be_rendered_without_terrain,
            is_texture_ready: is_texture_loaded,
            is_terrain_ready,
            is_upsamplable: is_in_upsample_band || can_upsample_failed,
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

    pub fn is_parent_ready(
        &self,
        qt: &TerrainTileQuadtree,
        terrain_data_requesters: &TileTerrainDataRequesterQuery,
    ) -> bool {
        self.get_parent_tile(qt).is_some_and(|p| {
            (p.is_terrain_ready(terrain_data_requesters) || p.upsampled)
                && p.cached_mesh_handle.is_some()
        })
    }

    pub fn is_upsamplable(
        &self,
        qt: &TerrainTileQuadtree,
        terrain_data_requester: &TileTerrainDataRequesterQuery,
        terrain_layer: &Option<&TerrainLayer>,
    ) -> bool {
        terrain_layer.is_some() && self.is_parent_ready(qt, terrain_data_requester)
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

    pub fn get_parent_tile<'a>(&self, qt: &'a TerrainTileQuadtree) -> Option<&'a Self> {
        qt.qt
            .parent((self.coords.x, self.coords.y, self.coords.z))
            .and_then(|p| qt.qt.get(p.handle()))
    }

    fn get_region(&self, parent: &TerrainTile) -> Option<TileRegion> {
        // Use tile coordinates rather than extents to detect the quadrant.
        // Both WebMercator and Geographic schemes share XYZ-style y (y=0 at the
        // north edge), so the relationship between parent and child indices is
        // identical: `(2x, 2y)` is the NW child, `(2x+1, 2y+1)` the SE, etc.
        // An extent-based check using the arithmetic midpoint of latitude is
        // incorrect for WebMercator: the projection is non-linear in lat, so
        // the actual boundary between north and south children does not sit at
        // `(south + north) / 2`. This was particularly visible in the southern
        // hemisphere, where the north child was misidentified as a south one.
        let is_east = self.coords.x == parent.coords.x * 2 + 1;
        let is_north = self.coords.y == parent.coords.y * 2;
        Some(match (is_east, is_north) {
            (false, true) => TileRegion::NorthWest,
            (true, true) => TileRegion::NorthEast,
            (false, false) => TileRegion::SouthWest,
            (true, false) => TileRegion::SouthEast,
        })
    }

    // Steps of upsampling for the raster DEM.
    // 1. If the status of the request for the terrain is failed, check if the parent is succeeded or upsampled.
    // 2. If the tile has already been upsampled, use it
    // 3. Find a grid that matches with tile's extent. And get a binary from the grid area of the height-map.
    // 4. Store the binary into the BufferStore, and store the handle in the tile.
    pub fn upsample(
        &self,
        ellipsoid: Ellipsoid<FloatType>,
        parent: &TerrainTile,
        upsamplable_geometry: UpsamplableTerrainGeometry,
    ) -> Option<ReturnedConstructedTerrainMesh> {
        let region = self.get_region(parent)?;

        let mut upsampled_mesh = self
            .terrain_data
            .as_ref()
            .and_then(|t| t.upsample(&region, upsamplable_geometry))?;

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

    // This function will be invoked before this tile is destroyed.
    pub fn destroy(&mut self, commands: &mut Commands, buf: &mut BufferStore) {
        if let Some(cached_mesh) = &self.cached_mesh_handle {
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
            self.cached_mesh_handle = None;
        }

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
        let sides = PoleSides::from_extent(&self.tiling_scheme, &self.extent);
        let (min, max) = sides.height_range(min_height, max_height);
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

/// Compute a terrain height at specified point.
pub fn compute_terrain_height_at_point(
    qt: &mut TerrainTileQuadtree,
    buf: &mut BufferStore,
    terrain_data_requesters: &TileTerrainDataRequesterQuery,
    point: &LngLat<FloatType, Radians>,
) -> Option<FloatType> {
    let tile_handle = find_contained_child(
        qt,
        &|t| t.extent.contains(point) && t.cached_mesh_handle.is_some() && !t.upsampled,
        &|t| t.extent.contains(point),
    )?;
    let tile = qt.qt.get_mut(tile_handle)?;

    tile.terrain_data.as_mut()?.compute_height_at_point(
        &tile.extent,
        buf,
        terrain_data_requesters,
        point,
    )
}

/// Compute a terrain height at specified point.
pub fn sample_terrain_height_within_extent(
    qt: &mut TerrainTileQuadtree,
    extent: Extent<f64, Radians>,
) -> (FloatType, FloatType) {
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

    let mut max_height: FloatType = 0.;
    let mut min_height: FloatType = 9999.;
    let mut has_terrain_data = false;
    for tile_handle in tiles {
        let tile = qt.qt.get_mut(tile_handle);
        let terrain_data = match tile.and_then(|t| t.terrain_data.as_ref()) {
            Some(t) => t,
            None => continue,
        };
        if let (Some(min_terrain_height), Some(max_terrain_height)) = (
            terrain_data.current_min_height(),
            terrain_data.current_max_height(),
        ) {
            has_terrain_data = true;
            min_height = min_height.min(min_terrain_height);
            max_height = max_height.max(max_terrain_height);
        }
    }

    // Extrude more
    max_height *= 1.3;

    // If the difference is close, then it should be expanded.
    // Or set default height if terrain_data isn't found.
    {
        let diff = max_height - min_height;
        // Need to investigate more why we need to extrude
        // an additional height if the terrain closes to zero.
        let distance_from_surface = 2000.0;
        if diff <= distance_from_surface || !has_terrain_data {
            min_height = -distance_from_surface / 2.;
            max_height = distance_from_surface;
        }
    }

    (min_height, max_height)
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

/// Terrain elevation `(max_height, min_height)` at the centre of `extent`, read
/// from the deepest rendered terrain tile covering that point.
///
/// This is a point-in-tile lookup, so it works regardless of tiling scheme — a
/// WebMercator raster tile can read the height of the Geographic (quantized-mesh)
/// terrain it drapes onto, where a coordinate-identity lookup would fail. Used to
/// keep the raster traversal's screen-space error in step with terrain elevation.
/// Returns `None` when no rendered terrain covers the centre.
pub fn terrain_height_for_extent(
    qt: &TerrainTileQuadtree,
    extent: &Extent<FloatType, Radians>,
) -> Option<(FloatType, FloatType)> {
    let center = LngLat {
        lng: (extent.west + extent.east) * 0.5,
        lat: (extent.south + extent.north) * 0.5,
    };
    let handle = find_contained_child(
        qt,
        &|t| t.extent.contains(&center) && t.cached_mesh_handle.is_some(),
        &|t| t.extent.contains(&center),
    )?;
    let tile = qt.qt.get(handle)?;
    Some((tile.max_height, tile.min_height))
}

/// Compute terrain height for a single point from a known tile.
/// Returns 0.0 if height cannot be determined.
pub fn compute_terrain_height_by_tile_handle(
    qt: &mut TerrainTileQuadtree,
    buf: &mut BufferStore,
    terrain_data_requesters: &TileTerrainDataRequesterQuery,
    tile_handle: TileHandle,
    point: &LngLat<FloatType, Radians>,
) -> f64 {
    let Some(tile) = qt.qt.get_mut(tile_handle) else {
        return 0.0;
    };
    let extent = tile.extent;
    let Some(terrain_data) = tile.terrain_data.as_mut() else {
        return 0.0;
    };
    terrain_data
        .compute_height_at_point(&extent, buf, terrain_data_requesters, point)
        .unwrap_or(0.0)
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

    use super::TerrainTileQuadtree;

    use super::{TerrainTile, find_contained_child};

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

        assert!(matches!(
            nw.get_region(&parent),
            Some(TileRegion::NorthWest)
        ));
        assert!(matches!(
            ne.get_region(&parent),
            Some(TileRegion::NorthEast)
        ));
        assert!(matches!(
            sw.get_region(&parent),
            Some(TileRegion::SouthWest)
        ));
        assert!(matches!(
            se.get_region(&parent),
            Some(TileRegion::SouthEast)
        ));
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

        assert!(matches!(
            nw.get_region(&parent),
            Some(TileRegion::NorthWest)
        ));
        assert!(matches!(
            ne.get_region(&parent),
            Some(TileRegion::NorthEast)
        ));
        assert!(matches!(
            sw.get_region(&parent),
            Some(TileRegion::SouthWest)
        ));
        assert!(matches!(
            se.get_region(&parent),
            Some(TileRegion::SouthEast)
        ));
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

    #[test]
    fn terrain_height_for_extent_reads_covering_tile() {
        use super::terrain_height_for_extent;

        let mut qt = setup_qt_with_ready_tiles();
        // Give a ready z=2 tile a known elevation.
        mark_tile_ready(&mut qt, (3, 1, 2));
        let handle = qt.qt.leaf((3, 1, 2)).unwrap().handle();
        {
            let t = qt.qt.get_mut(handle).unwrap();
            t.max_height = 1500.;
            t.min_height = -20.;
        }

        // An extent centred inside that tile resolves to its elevation
        // (point-in-tile, independent of coordinate identity).
        let extent = qt.qt.get(handle).unwrap().extent;
        assert_eq!(terrain_height_for_extent(&qt, &extent), Some((1500., -20.)));
    }

    #[test]
    fn terrain_height_for_extent_none_without_ready_terrain() {
        use super::terrain_height_for_extent;

        // No tile has a cached mesh → nothing to read.
        let qt = setup_qt_with_ready_tiles();
        let extent = qt
            .qt
            .get(qt.qt.leaf((3, 1, 2)).unwrap().handle())
            .unwrap()
            .extent;
        assert_eq!(terrain_height_for_extent(&qt, &extent), None);
    }

    /// Cross-scheme drape: a WebMercator vector tile reads the elevation of the
    /// Geographic (quantized-mesh) terrain it overlaps. The vector traverse keys on
    /// the extent's centre (point-in-tile), so it resolves even though the WM tile's
    /// coordinates do not exist in the Geographic quadtree — the exact path that a
    /// by-handle lookup got wrong, leaving the drape coarse.
    #[test]
    fn terrain_height_for_extent_reads_geographic_terrain_via_web_mercator_extent() {
        use super::terrain_height_for_extent;

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
        // East root (1,0,0) covers lng 0..180°, lat -90..90°; give it a known elevation.
        mark_tile_ready(&mut qt, (1, 0, 0));
        let geo_handle = qt.qt.leaf((1, 0, 0)).unwrap().handle();
        {
            let t = qt.qt.get_mut(geo_handle).unwrap();
            t.max_height = 3776.;
            t.min_height = 0.;
        }

        // A real WebMercator tile whose centre (~102°E, ~11°N) lands inside the
        // eastern hemisphere. Its WM coordinates have no twin in the Geographic
        // quadtree, so only the by-extent lookup can resolve it.
        let wm_extent = TilingScheme::WebMercator { tms: false }.tile_extent(TileXYZ {
            x: 200,
            y: 120,
            z: 8,
        });

        assert_eq!(
            terrain_height_for_extent(&qt, &wm_extent),
            Some((3776., 0.))
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
                        &qt,
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

        /// Fail with no parent terrain: last-resort flat fallback (own ready but not
        /// upsamplable).
        #[test]
        fn falls_back_to_flat_when_fail_and_no_parent() {
            let rs = run(Scenario {
                self_dem_status: Some(DataRequesterStatus::Fail),
                parent_terrain_ready: false,
                terrain_max_zoom: 20,
                terrain_overscaled_max_zoom: 24,
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

        /// Regression guard for the upsample band (max_zoom < z < overscaled_max_zoom)
        /// with a ready parent: should still upsample without needing a Fail status.
        #[test]
        fn in_upsample_band_unchanged() {
            let rs = run(Scenario {
                // No requester at all — upsample band doesn't fetch DEM.
                self_dem_status: None,
                parent_terrain_ready: true,
                terrain_max_zoom: 0,
                terrain_overscaled_max_zoom: 5,
            });
            assert!(
                rs.is_tile_ready,
                "Upsample band with ready parent must be ready"
            );
            assert!(rs.is_upsamplable, "Upsample band must take upsample path");
        }

        /// Pending request (no Success, no Fail yet) must not be ready: waiting on the
        /// fetch — the traversal parent-fallback handles visibility.
        #[test]
        fn pending_is_not_ready() {
            let rs = run(Scenario {
                self_dem_status: Some(DataRequesterStatus::Pending),
                parent_terrain_ready: true,
                terrain_max_zoom: 20,
                terrain_overscaled_max_zoom: 24,
            });
            assert!(!rs.is_tile_ready, "Pending must not be marked ready");
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
