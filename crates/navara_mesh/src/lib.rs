#![doc = include_str!("../README.md")]

use bevy_app::{PostUpdate, PreUpdate};
use bevy_ecs::{
    bundle::Bundle,
    change_detection::DetectChanges,
    component::Component,
    entity::Entity,
    query::{Added, Changed, Or, With, Without},
    system::{Commands, Query, Res, ResMut},
};

mod cache;
pub use cache::*;
use navara_buffer_store::Handle;
use navara_component::Deleted;
use navara_core::Aabb;
use navara_event_store::EventStore;
use navara_globe::Globe;
use navara_material::RasterTileInternalMaterial;
use navara_math::Transform;

#[derive(Component, Debug, Default)]
pub struct ObjectMarker;

#[derive(Bundle, Debug)]
pub struct ObjectBundle {
    pub transform: Transform,
    pub marker: ObjectMarker,
}

#[derive(Debug, Clone, Component)]
pub struct Mesh {
    pub vertices: Handle,
    pub uvs: Handle,
    pub indices: Handle,
    pub active: bool,
    /// Quadrants of the tile to draw, as a bitmask over the child slots
    /// (bit `i` is `child_coords(_, i)`: `i % 2` east, `i / 2` south).
    /// `0` draws the whole tile. A shown parent uses this to fill only the
    /// quadrants of children that are not prepared yet, without overlapping
    /// the children that are on screen.
    pub fill_quadrants: u8,
    pub render_order: i32,
    pub aabb: Aabb,
    /// Per-vertex normals for the terrain. Stride 3.
    pub normals: Option<Handle>,
    /// Skirt vertices (separate from main geometry for shadow/normal handling).
    pub skirt_vertices: Option<Handle>,
    /// Skirt UVs.
    pub skirt_uvs: Option<Handle>,
    /// Skirt indices.
    pub skirt_indices: Option<Handle>,
    /// Skirt normals, copied from corresponding edge vertices. Stride 3.
    pub skirt_normals: Option<Handle>,
    /// Watermask payload (1 byte for uniform, 65536 bytes for 256x256 grid).
    pub watermask: Option<Handle>,
}

#[derive(Bundle, Debug)]
pub struct MeshBundle<M: Component> {
    pub mesh: Mesh,
    pub material: M,
    pub object: ObjectBundle,
}

pub struct MeshPlugin;

impl bevy_app::Plugin for MeshPlugin {
    fn build(&self, app: &mut bevy_app::App) {
        app.add_systems(PreUpdate, remove_removed_mesh)
            .add_systems(PostUpdate, commit_events);
    }
}

#[allow(clippy::type_complexity)]
fn commit_events(
    mut events: ResMut<EventStore>,
    globe_res: Res<Globe>,
    all_meshes: Query<Entity, (With<Mesh>, Without<Deleted>)>,
    removed: Query<Entity, (With<Mesh>, With<Deleted>)>,
    t_changed: Query<Entity, (With<Mesh>, Changed<Transform>, Without<Deleted>)>,
    mesh_added: Query<Entity, (Added<Mesh>, Without<Deleted>)>,
    mesh_changed: Query<
        Entity,
        (
            Or<(Changed<Mesh>, Changed<RasterTileInternalMaterial>)>,
            Without<Deleted>,
        ),
    >,
    // mat_changed: Query<(Entity, &ObjectMarker, &Material), Changed<Material>>,
) {
    for e in t_changed.iter() {
        events.object_transform_updated.push(e);
    }

    for e in mesh_added.iter() {
        events.mesh_added.push(e);
    }

    for e in mesh_changed.iter() {
        events.mesh_updated.push(e);
    }
    if globe_res.is_changed() {
        for e in all_meshes.iter() {
            events.mesh_updated.push(e);
        }
    }

    // for (e, _, _) in mat_changed.iter() {
    //     events.mesh_updated.push(e);
    // }

    for e in &removed {
        events.mesh_removed.push(e);
    }
}

pub fn remove_removed_mesh(
    mut commands: Commands,
    removed: Query<Entity, (With<Mesh>, With<Deleted>)>,
) {
    for e in &removed {
        commands.entity(e).despawn();
    }
}
