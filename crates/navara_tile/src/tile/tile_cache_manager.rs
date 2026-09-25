use bevy_ecs::{
    entity::Entity,
    prelude::Resource,
    query::{With, Without},
    system::Query,
};
use navara_component::Deleted;
use navara_memory::RetainedEntry;
use navara_mesh::Mesh;
use navara_tile_component::{TileHandle, TileMeshMarker};
use rustc_hash::{FxHashMap, FxHashSet};

/// Per-layer parent reference used when sampling a parent tile's data
/// (e.g. when this tile is overscaled or its own data isn't ready yet).
/// `entity` is the parent fragment/data-requester entity, `zoom` is the
/// parent tile's zoom level so a `uv_transform(child, parent_zoom)` can be derived.
#[derive(Debug, Clone, Copy)]
pub struct LayerParent {
    pub entity: Entity,
    pub zoom: usize,
}

/// This struct caches an information that is necessary in rendering.
/// Of course, we can store these value in the tile of TileQuadtree,
/// but accessing it is a little bit high cost.
/// These values are removed and added frequently,so we should use this cache structure.
pub struct RenderedTileCache {
    pub mesh_entity: Option<Entity>,
    /// This tile should be used to show the parent tile instead of the child tile if the child tile is still preparing.
    pub ready_parent_tile_handle: Option<TileHandle>,
    /// Per-layer parent entities computed during traversal.
    /// Index corresponds to layer index (sorted by `Order`).
    /// `None` slot means the layer's own entity is ready (no parent reuse).
    /// Shared (Arc) with the traversal, which hands the same list to every child.
    pub layer_parents: Option<std::sync::Arc<Vec<Option<LayerParent>>>>,
    pub rendered_tile_entity: Entity,
    /// This is used to check if the mesh is prepared in client side.
    /// Because sometimes rendering engine needs to do some preparation asynchronously.
    pub mesh_prepared: bool,
    /// Flag indicating this tile needs material update (e.g., hillshade parent reuse, UV transforms)
    pub needs_material_update: bool,
    /// Spawned speculatively for a horizon-occluded tile (see
    /// `prefetch_occluded_tile`) and never shown yet, so it is the first
    /// candidate when the memory budget forces eviction. Cleared as soon as
    /// the visible path spawns/updates this tile.
    pub prefetched: bool,
}

// Manage the tiles that are going to be rendered.
#[derive(Default, Resource)]
pub struct TileCacheManager {
    pub rendered_tile_caches: FxHashMap<TileHandle, RenderedTileCache>,
    pub requested_tile_caches: FxHashSet<TileHandle>,
    /// Tiles that left the view but are kept alive (mesh deactivated) until
    /// the memory budget forces eviction. Keys are also present in
    /// `rendered_tile_caches`.
    pub retained: FxHashMap<TileHandle, RetainedEntry>,
    pub last_rendered_frame: usize,
    pub is_updated_in_this_frame: bool,
    pub prev_layers_len: usize,
    /// Set when a source changes (e.g. `updateSource`) to force one re-traversal
    /// even with a static camera, so terrain tiles pick up the new fetch config
    /// read live from the source. Cleared once consumed.
    pub force_update: bool,
}

impl TileCacheManager {
    /// Show or hide the tile's mesh in full. Returns whether the mesh came
    /// on screen in full — from hidden or from fill mode — so a caller can
    /// react to a tile taking over its region.
    pub fn activate_rendered_tile(
        &self,
        handle: &TileHandle,
        meshes: &mut Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
        active: bool,
    ) -> bool {
        let Some(t) = self.rendered_tile_caches.get(handle) else {
            return false;
        };
        let Some(mesh_entity) = t.mesh_entity else {
            return false;
        };
        let Ok(mesh) = meshes.get(mesh_entity) else {
            return false;
        };

        if mesh.active == active && mesh.fill_quadrants == 0 {
            return false;
        }
        let mut mesh = meshes.get_mut(mesh_entity).unwrap();
        let shown = active && (!mesh.active || mesh.fill_quadrants != 0);
        mesh.active = active;
        mesh.fill_quadrants = 0;
        shown
    }

    /// Show the tile's mesh restricted to `quadrants` (a `Mesh::fill_quadrants`
    /// mask): the parent fills the quadrants of children that are not
    /// prepared yet while the prepared children stay on screen.
    pub fn fill_rendered_tile(
        &self,
        handle: &TileHandle,
        meshes: &mut Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
        quadrants: u8,
    ) {
        let Some(t) = self.rendered_tile_caches.get(handle) else {
            return;
        };
        let Some(mesh_entity) = t.mesh_entity else {
            return;
        };
        let Ok(mesh) = meshes.get(mesh_entity) else {
            return;
        };
        if mesh.active && mesh.fill_quadrants == quadrants {
            return;
        }
        let mut mesh = meshes.get_mut(mesh_entity).unwrap();
        mesh.active = true;
        mesh.fill_quadrants = quadrants;
    }

    pub fn is_rendered_tile_activated(
        &self,
        handle: &TileHandle,
        meshes: &mut Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
    ) -> bool {
        let t = match self.rendered_tile_caches.get(handle) {
            Some(t) => t,
            None => return false,
        };
        let mesh_entity = match t.mesh_entity {
            Some(m) => m,
            None => return false,
        };
        let mesh = match meshes.get(mesh_entity) {
            Ok(m) => m,
            Err(_) => return false,
        };
        mesh.active
    }

    pub fn set_is_rendered_tile_prepared(&mut self, handle: &TileHandle, prepared: bool) {
        let t = match self.rendered_tile_caches.get_mut(handle) {
            Some(t) => t,
            None => return,
        };

        t.mesh_prepared = prepared;
    }

    pub fn is_rendered_tile_prepared(&self, handle: &TileHandle) -> bool {
        let t = match self.rendered_tile_caches.get(handle) {
            Some(t) => t,
            None => return false,
        };

        t.mesh_prepared
    }
}
