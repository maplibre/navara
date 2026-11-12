use bevy_ecs::{component::Component, entity::Entity};
use navara_component::Priority;
use navara_memory::RetainedEntry;
use navara_tile_component::TileHandle;
use rustc_hash::FxHashMap;

// Manage the tiles that are going to be rendered.
#[derive(Default, Component)]
pub struct TileCacheManager {
    pub rendered_tile_caches: FxHashMap<TileHandle, Entity>,
    pub requested_tile_caches: FxHashMap<TileHandle, Entity>,
    /// The tiles the last traversal asked data for, with the priority it
    /// asked at. A request still waiting for a slot is ranked by this, and is
    /// dropped once its tile is no longer in it.
    pub wanted_data: FxHashMap<TileHandle, Priority>,
    /// Tiles that left the view but are kept alive (deactivated) until the
    /// memory budget forces eviction. Keys are also present in
    /// `rendered_tile_caches`.
    pub retained: FxHashMap<TileHandle, RetainedEntry>,
    pub last_rendered_frame: usize,
    pub is_updated_in_this_frame: bool,
    pub needs_update: bool,
    /// Set by a traverse that changed a tile's drape source
    /// (`ready_parent_tile_handle`).
    pub drape_sources_changed: bool,
}

impl TileCacheManager {
    pub fn has_same_rendered_tile(&self, handle: &TileHandle, target: &Entity) -> bool {
        self.rendered_tile_caches.get(handle) == Some(target)
    }
}
