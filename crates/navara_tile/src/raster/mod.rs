mod request;
mod resolve;
pub mod system;
pub mod tile_cache_manager;
mod traverse;

use bevy_ecs::prelude::Resource;

pub use resolve::{
    RASTER_DRAPE_OVERLAP_BUDGET, RasterBakeLayer, ResolvedRasterTexture, ResolvedRasterTileState,
    resolve_raster_texture, resolve_raster_tile_states,
};
pub use tile_cache_manager::RasterTileCacheManager;
pub use traverse::traverse_raster;

/// Monotonic counter bumped whenever the raster drape resolution could have changed:
/// texture fragments were added/loaded/failed, the layer set changed (in bake-relevant
/// config — appearance-only mutations are filtered out), raster tiles were destroyed
/// (cache prune / memory eviction), or the globe tiling scheme flipped (which switches
/// between baked and direct drape slots). Camera movement alone does NOT bump
/// it — an existing terrain tile's resolve depends only on the loaded-fragment set, so
/// bumping every traverse made every visible tile re-resolve every frame during camera
/// motion (an FPS killer). The web renderer reads it once per frame and skips the
/// per-terrain-tile `getRasterTileStates` calls while it is unchanged. Wrapping is
/// fine — only equality across consecutive frames matters. Mirrors
/// `VectorResolveRevision`.
#[derive(Resource, Default)]
pub struct RasterResolveRevision(pub u32);

impl RasterResolveRevision {
    /// Mark the resolution as potentially changed since the last frame.
    pub fn bump(&mut self) {
        self.0 = self.0.wrapping_add(1);
    }
}

/// Per-revision snapshot of the baked-drape resolve inputs, so the per-terrain-tile
/// `get_raster_tiles` calls stay cheap: without it, every call re-created world
/// queries, re-scanned every texture fragment into a set and re-sorted the layer
/// list — per visible tile, per frame. Refreshed by [`system::snapshot_raster_bake_inputs`]
/// only when [`RasterResolveRevision`] changed; empty when the globe tiling scheme is
/// not Geographic (nothing bakes there).
#[derive(Resource, Default)]
pub struct RasterBakeSnapshot {
    /// Baked (non-hillshade) layers in sorted order — `layer_ordinal` source of truth.
    pub layers: Vec<RasterBakeLayer>,
    /// Texture fragment entities whose data finished loading.
    pub loaded: rustc_hash::FxHashSet<bevy_ecs::entity::Entity>,
}
