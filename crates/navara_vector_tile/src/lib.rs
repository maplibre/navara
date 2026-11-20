use bevy_app::{App, Plugin, Update};
use bevy_ecs::prelude::Resource;
use bevy_ecs::schedule::{IntoScheduleConfigs, SystemSet};

pub mod component;
pub mod data_requester;
pub mod drape_sources;
pub mod layer;
pub mod resolve;
pub mod source;
pub mod source_cache;
pub mod tile;

pub use component::*;
pub use drape_sources::{VectorDrapeSources, hand_over_vector_drape_sources};
pub use layer::resource::LayerResources;
pub use layer::tile_cache_manager::TileCacheManager;
pub use navara_parser::mvt::{AsXYZ, PosConverter};
pub use resolve::{
    ResolvedVectorTile, ResolvedVectorTileState, resolve_vector_tile_states, resolve_vector_tiles,
};
pub use source::{ReadyState, TileSource, VectorTileSource, max_feature_height};
pub use source_cache::{
    CLAMP_TO_GROUND_DYNAMIC_SSE_SCALE, GEOMETRY_DYNAMIC_SSE_SCALE, SourceId, TraversalConfig,
    VectorTileSourceCache, VectorTileSourceResources,
};
pub use tile::render::{OwningVectorTile, RenderedTile, VectorTileGpuCost};
pub use tile::system::estimate_vector_tile_cost;
pub use tile::traverse::{
    TraversalResult, activate_all_renderable_features, are_all_renderable_features_active,
    spawn_tile_entity, traverse_tile,
};

/// Monotonic counter bumped whenever the vector-tile resolution could have changed: a
/// traverse changed a tile's drape source (`ready_parent_tile_handle`). The drape source
/// hand-over ([`hand_over_vector_drape_sources`]) re-resolves the shown terrain tiles only
/// when it changes. Wrapping is fine — only equality across consecutive frames matters.
#[derive(Resource, Default)]
pub struct VectorResolveRevision(pub u32);

impl VectorResolveRevision {
    /// Mark the resolution as potentially changed since the last frame.
    pub fn bump(&mut self) {
        self.0 = self.0.wrapping_add(1);
    }
}

/// System sets for ordering vector tile processing stages.
///
/// External plugins (e.g. MvtPlugin, GeoJsonPlugin) should add their
/// source/layer preparation systems to [`VectorTileSet::Prepare`] so they
/// run before the core tile traversal in [`VectorTileSet::Process`].
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub enum VectorTileSet {
    /// Preparation phase: layer resources and tile sources are set up.
    Prepare,
    /// Processing phase: tile traversal, mesh transfer, and cache cleanup.
    Process,
}

pub struct VectorTilePlugin;

impl Plugin for VectorTilePlugin {
    fn build(&self, app: &mut App) {
        app.configure_sets(
            Update,
            VectorTileSet::Prepare.before(VectorTileSet::Process),
        );

        app.init_resource::<VectorResolveRevision>();
        app.init_resource::<VectorDrapeSources>();

        app.init_resource::<VectorTileSourceCache>().add_systems(
            Update,
            (
                tile::system::reload_source_tiles,
                tile::system::update_tiles,
                tile::system::transfer_mesh,
                data_requester::system::filter_requestable_data_requester,
                tile::system::clear_caches,
                tile::system::enforce_memory_budget,
                hand_over_vector_drape_sources,
            )
                .chain()
                .in_set(VectorTileSet::Process),
        );
    }
}
