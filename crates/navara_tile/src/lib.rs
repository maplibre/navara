#![doc = include_str!("../README.md")]

pub mod data_requester;
pub mod hillshade;
pub mod raster;
pub mod texture_fragment;

use bevy_app::{App, Plugin, PostUpdate, PreUpdate, Update};
use bevy_ecs::schedule::{IntoScheduleConfigs, SystemSet};
use navara_data_requester::{DataManager, DataRequesterSet};
use navara_tile_component::{
    CachedMartini, RasterTileQuadtree, TerrainInformationQuadtree, TerrainTileQuadtree,
};
use raster::RasterTileCacheManager;
use tile::{event::MeshPreparedEvent, tile_cache_manager::TileCacheManager};

/// System set for terrain tile processing.
/// Feature systems that depend on terrain data should run `.after(TileSet)`.
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub struct TileSet;

pub mod terrain;
pub mod tile;

pub struct TilePlugin;

impl Plugin for TilePlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<TileCacheManager>()
            .init_resource::<CachedMartini>()
            .init_resource::<DataManager>()
            .insert_resource(TerrainTileQuadtree::new_with_linear_qt())
            .insert_resource(TerrainInformationQuadtree::new_with_linear_qt())
            .insert_resource(RasterTileQuadtree::new_with_linear_qt())
            .init_resource::<RasterTileCacheManager>()
            .init_resource::<raster::RasterResolveRevision>()
            .init_resource::<raster::RasterBakeSnapshot>()
            .add_message::<MeshPreparedEvent>()
            .add_systems(
                PostUpdate,
                terrain::nodata_system::fill_polar_dem_nodata.after(DataRequesterSet::SendRequests),
            )
            .add_systems(
                PreUpdate,
                (
                    tile::system::handle_prepared_mesh_event,
                    tile::system::handle_tile_worker_task_completed,
                    tile::system::add_order_to_tiles_layer,
                )
                    .chain(),
            )
            .add_systems(
                Update,
                (
                    (
                        tile::system::update_layer,
                        tile::system::delete_layer,
                        tile::system::update_terrain_layer,
                        tile::system::sync_terrain_layer_changes,
                        tile::system::init_globe_tiling,
                        raster::system::init_raster_tiling,
                        raster::system::update_raster_tiles,
                        raster::system::clear_raster_caches,
                        raster::system::enforce_memory_budget,
                        raster::system::attach_texture_fragment_cost,
                        tile::system::update_terrain,
                        tile::system::transfer_mesh,
                        tile::system::attach_terrain_mesh_cost,
                    )
                        .chain(),
                    (
                        tile::system::update_mesh_material,
                        raster::system::filter_requestable_raster_texture_fragment,
                        data_requester::system::filter_requestable_data_requester,
                        hillshade::filter_requestable_hillshade_data_requester,
                        hillshade::backfill_hillshade_on_loaded,
                        tile::system::clear_caches,
                        tile::system::enforce_memory_budget,
                        // Last raster-revision consumer: every bump this frame
                        // (traverse, prune, eviction) has already happened.
                        raster::system::snapshot_raster_bake_inputs,
                        terrain::system::update_height_observers,
                        hillshade::cleanup_hillshade_edges,
                        hillshade::cleanup_hillshade_backfill_events,
                        hillshade::emit_hillshade_canceled,
                    )
                        .chain(),
                )
                    .chain()
                    .in_set(TileSet),
            );
    }
}
