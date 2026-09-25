use std::fmt::Debug;

use crate::terrain_data_requester::TileTerrainDataRequesterQuery;
use bevy_ecs::entity::Entity;
use martini::Martini;
use navara_buffer_store::BufferStore;
use navara_core::{
    ElevationDecoder, Ellipsoid, Extent, LngLat, Radians, TileRegion, TileXYZ, TilingScheme,
    get_ellipsoid_terrain_level_zero_maximum_geometric_error, get_level_maximum_geometric_error,
};
use navara_geometry::{
    ReturnedConstructedTerrainMesh, UpsamplableTerrainGeometry, UpsampledTerrainGeometry,
};
use navara_math::FloatType;

pub struct TerrainConstructContext {
    pub coords: TileXYZ,
    pub extent: Extent<FloatType, Radians>,
    pub max_height: FloatType,
}

impl TerrainConstructContext {
    pub fn get_level_maximum_geometric_error(
        &self,
        ellipsoid: &Ellipsoid<FloatType>,
        height_map_width: FloatType,
    ) -> FloatType {
        get_level_maximum_geometric_error(
            self.coords.z,
            get_ellipsoid_terrain_level_zero_maximum_geometric_error(ellipsoid, height_map_width),
        )
    }
}

pub trait TerrainData: Debug + Sync + Send {
    /// Clip an ancestor's geometry down to this tile along `regions`, the
    /// quadrant path from that ancestor (see `TerrainTile::region_path_from`).
    fn upsample(
        &self,
        regions: &[TileRegion],
        upsamplable_geometry: UpsamplableTerrainGeometry,
    ) -> Option<UpsampledTerrainGeometry>;
    fn construct_terrain_mesh(
        &self,
        ellipsoid: Ellipsoid<FloatType>,
        ctx: &TerrainConstructContext,
        bytes: &[u8],
        geoid_height: FloatType,
        martini: Option<&mut Martini>,
    ) -> ReturnedConstructedTerrainMesh;
    fn data_requester_entity_id(&self) -> Option<Entity>;
    fn set_data_requester_entity_id(&mut self, e: Option<Entity>);
    /// Compute a terrain height at specified point.
    fn compute_height_at_point(
        &mut self,
        extent: &Extent<FloatType, Radians>,
        buf: &mut BufferStore,
        terrain_data_requesters: &TileTerrainDataRequesterQuery,
        point: &LngLat<FloatType, Radians>,
    ) -> Option<FloatType>;
    // Indicates the max height of the terrain from the globe surface.
    fn current_max_height(&self) -> Option<FloatType>;
    fn set_current_max_height(&mut self, h: FloatType);
    fn current_min_height(&self) -> Option<FloatType>;
    fn set_current_min_height(&mut self, h: FloatType);
    fn destroy(&mut self, buf: &mut BufferStore);
    fn box_clone(&self) -> Box<dyn TerrainData>;
    fn decoder(&self) -> Option<&ElevationDecoder> {
        None
    }

    fn tiling_scheme(&self) -> TilingScheme {
        TilingScheme::default()
    }
}
