//! Resources for Cesium 3D Tiles State Management
//!
//! This module contains ECS resources used to share parsed nested-tileset
//! metadata across the tile system. Runtime tile state lives inline in the
//! recursive [`Cesium3dTileContent`] tree, not here.

use std::sync::Arc;

use bevy_ecs::{entity::Entity, resource::Resource};
use rustc_hash::FxHashMap;
use url::Url;

/// Static, parsed metadata for a single loaded nested `tileset.json`.
///
/// Treat this struct as read-only after insertion — analogous to
/// [`Cesium3dTileContentMetadata`](super::Cesium3dTileContentMetadata).
/// Per-frame mutable state for the nested tiles is stored inline in the
/// parent JSON tile's [`Cesium3dTileContent::children`](super::Cesium3dTileContent)
/// via the traversal pivot.
#[derive(Debug)]
pub struct Cesium3dTilesNestedSubtreeMetadata {
    pub base_url: Arc<Url>,
    pub metadata: navara_parser::cesium3dtiles::tileset::Tileset,
    pub is_v1_1: bool,
}

/// Map of loaded nested tileset metadata keyed by the parent JSON tile's
/// `data_requester_id` (the [`DataRequester`](navara_data_requester::DataRequester)
/// entity that fetched the nested `tileset.json`).
///
/// Populated by `construct_cesium_3d_tiles_tree` when a nested tileset
/// finishes loading. Read by `mark_leaves` / `mark_rendered_tiles` to pivot
/// the children iteration onto the loaded tileset's root tile. Removed by
/// `remove_resources_if_no_rendered_tile` when the parent JSON tile is no
/// longer rendered.
#[derive(Default, Debug, Resource)]
pub struct Cesium3dTilesNestedTreeMap {
    map: FxHashMap<Entity, Cesium3dTilesNestedSubtreeMetadata>,
}

impl Cesium3dTilesNestedTreeMap {
    pub fn insert(&mut self, key: Entity, sub: Cesium3dTilesNestedSubtreeMetadata) {
        self.map.insert(key, sub);
    }

    pub fn get(&self, key: &Entity) -> Option<&Cesium3dTilesNestedSubtreeMetadata> {
        self.map.get(key)
    }

    pub fn contains(&self, key: &Entity) -> bool {
        self.map.contains_key(key)
    }

    pub fn remove(&mut self, key: &Entity) -> Option<Cesium3dTilesNestedSubtreeMetadata> {
        self.map.remove(key)
    }
}
