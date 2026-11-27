use bevy_ecs::prelude::Resource;
use navara_memory::RetainedEntry;
use navara_tile_component::{MinZoomDescentBudget, TileHandle};
use rustc_hash::{FxHashMap, FxHashSet};

/// Tracks which raster tiles were visited so stale ones can be pruned. Raster
/// tiles own no mesh entity, so unlike the terrain `TileCacheManager` this only
/// needs the set of live handles plus frame bookkeeping.
#[derive(Default, Resource)]
pub struct RasterTileCacheManager {
    /// Handles touched by the most recent traversals. Used by
    /// `clear_raster_caches` to find tiles to prune.
    pub active_handles: FxHashSet<TileHandle>,
    /// Tiles that left the view but keep their quadtree node and texture
    /// fragments alive until the memory budget forces eviction. Disjoint
    /// from `active_handles`; a revisit moves the handle back there.
    pub retained: FxHashMap<TileHandle, RetainedEntry>,
    pub last_rendered_frame: usize,
    pub is_updated_in_this_frame: bool,
    pub prev_layers_len: usize,
    pub min_zoom_descent: MinZoomDescentBudget,
    /// Bake-relevant layer config from the last change, one entry per layer in
    /// sorted (`Order`) order: (has hillshade, has heatmap, shown, source id).
    /// Filters opacity/color-only `Changed<TilesLayer>` events out of the
    /// resolve-revision bump in `update_raster_tiles` — a per-frame opacity
    /// animation must not re-resolve every visible terrain tile's drape.
    pub bake_config_fingerprint: Vec<(bool, bool, bool, Option<String>)>,
    /// A bake-relevant layer change observed by a run of `update_raster_tiles`
    /// that early-returned before committing it (occluder/camera not spawned
    /// yet). `Changed<TilesLayer>` fires only once, so the swallowed trigger is
    /// carried here until a run gets far enough to commit the fingerprint and
    /// bump the resolve revision.
    pub pending_layers_changed: bool,
}
