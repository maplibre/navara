#![doc = include_str!("../README.md")]
//!
//! # System Ordering
//!
//! The plugin registers systems in a specific order to ensure correct data flow.
//! Systems are chained within each group to run sequentially.
//!
//! ## Standalone Layer Systems
//!
//! For B3DM and PNTS files loaded directly (not via 3D Tiles):
//! - `request_model_by_*_layer` → `construct_model_by_*_layer` →
//!   `delete_model_by_*_layer` → `update_model_by_*_layer`
//!
//! ## 3D Tiles System Chain
//!
//! The main 3D Tiles processing pipeline:
//!
//! 1. **request_metadata** - Spawn data requesters for new tilesets
//! 2. **construct_cesium_3d_tiles_tree** - Parse tileset.json into tree (root) or
//!    [`Cesium3dTilesNestedTreeMap`] (nested)
//! 3. **traverse_cesium_3d_tiles_tree** - Select visible tiles based on SSE,
//!    descending into nested tilesets in-line
//! 4. **filter_requestable_data_requester** - Prioritize pending data requests
//! 5. **construct_model_by_cesium3dtiles_layer** (generic) - Create models for all formats
//! 6. **remove_invisible_rendered_tiles** (generic/GLB) - Clean up invisible tiles
//! 7. **delete_cesium3dtiles_layer** - Handle layer deletion
//! 8. **update_cesium3dtiles_layer** - Handle material updates
//!
//! ## Integration with navara_feature
//!
//! After model construction, `navara_feature::model::system::transfer_mesh` runs
//! (in a different plugin) to convert `ModelGeometry` + `ModelBin` into
//! `RenderableFeature::Model`.
//!
//! When tiles are marked `Deleted`, `navara_feature::model::system::remove_batched_feature`
//! handles final cleanup of buffers and batch tables.

use bevy_app::{App, Plugin, PostUpdate, Update};

mod b3dm;
mod cesium3dtiles;
mod cleanup_system;
mod construct_system;
mod feature_table;
mod glb;
mod gltf_features;
mod i3dm;
mod pnts;
mod tile_content_parser;

use bevy_ecs::schedule::IntoScheduleConfigs;
pub use cesium3dtiles::*;
pub use cleanup_system::{Cesium3dTilesRetentionPool, ModelContentIndex};
use navara_data_requester::{DataRequesterSet, send_data_request_events_with_priority_and_sort};

/// Plugin that adds Cesium 3D Tiles support to the Navara engine.
///
/// Registers all systems needed for loading, traversing, rendering, and
/// cleaning up 3D Tiles datasets. Format-specific parsing is abstracted
/// behind the `TileContentParser` trait, with generic systems handling
/// the common lifecycle.
pub struct Cesium3dTilesPlugin;

impl Plugin for Cesium3dTilesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<Cesium3dTilesNestedTreeMap>();
        app.init_resource::<cleanup_system::Cesium3dTilesRetentionPool>();
        app.init_resource::<cleanup_system::ModelContentIndex>();
        // Standalone B3DM layer systems (not part of 3D Tiles)
        app.add_systems(
            Update,
            (
                b3dm::system::request_model_by_b3dm_layer,
                b3dm::system::construct_model_by_b3dm_layer,
                b3dm::system::delete_model_by_b3dm_layer,
                b3dm::system::update_model_by_b3dm_layer,
            )
                .chain(),
        )
        // Standalone PNTS layer systems (not part of 3D Tiles)
        .add_systems(
            Update,
            (
                pnts::system::request_model_by_pnts_layer,
                pnts::system::construct_model_by_pnts_layer,
                pnts::system::delete_model_by_pnts_layer,
                pnts::system::update_model_by_pnts_layer,
            )
                .chain(),
        )
        // Main 3D Tiles processing pipeline
        .add_systems(
            Update,
            (
                // Phase 1: Tree construction
                cesium3dtiles::system::request_metadata,
                cesium3dtiles::system::construct_cesium_3d_tiles_tree,
                // Phase 2: Tile selection
                cesium3dtiles::system::traverse_cesium_3d_tiles_tree,
                cesium3dtiles::data_requester::systems::filter_requestable_data_requester,
                cesium3dtiles::data_requester::systems::filter_requestable_metadata_requester,
                // Phase 3: Model construction (generic, format-specific parsing via trait)
                construct_system::construct_model_by_cesium3dtiles_layer::<b3dm::parser::B3dmParser>,
                construct_system::construct_model_by_cesium3dtiles_layer::<pnts::parser::PntsParser>,
                construct_system::construct_model_by_cesium3dtiles_layer::<glb::parser::GlbParser>,
                construct_system::construct_model_by_cesium3dtiles_layer::<gltf_features::parser::GltfFeaturesParser>,
                construct_system::construct_model_by_cesium3dtiles_layer::<i3dm::parser::I3dmParser>,
                // Phase 4: Cleanup (generic for all formats)
                cleanup_system::remove_invisible_rendered_tiles::<b3dm::parser::B3dmParser>,
                cleanup_system::remove_invisible_rendered_tiles::<pnts::parser::PntsParser>,
                cleanup_system::remove_invisible_rendered_tiles::<glb::parser::GlbParser>,
                cleanup_system::remove_invisible_rendered_tiles::<gltf_features::parser::GltfFeaturesParser>,
                cleanup_system::remove_invisible_rendered_tiles::<i3dm::parser::I3dmParser>,
                cleanup_system::enforce_memory_budget,
                // Phase 5: Layer management
                cesium3dtiles::system::delete_cesium3dtiles_layer,
                cesium3dtiles::system::update_cesium3dtiles_layer,
            )
                .chain(),
        )
        .add_systems(
            PostUpdate,
            send_data_request_events_with_priority_and_sort::<TileOrderByDistance>
                .in_set(DataRequesterSet::PrioritizeRequests),
        );
    }
}
