use bevy_ecs::component::Component;
use navara_buffer_store::{BufferStore, Handle};
use navara_geometry::TransferableGeometry;
use navara_math::{FloatType, Vec3};
use navara_tile_component::TileHandle;
use serde::Serialize;

use crate::component::{FreeResultBuffers, WorkerTaskBundle, free_unconsumed_buffers};

#[derive(Component)]
pub struct UpsampleTerrainMeshMarker;

#[derive(Component, Clone, Debug, Serialize)]
pub struct UpsampleTerrainMeshParameters {
    pub tile_handle: TileHandle,
    /// Whether to render skirts along tile boundaries.
    pub skirt: bool,
    /// Multiplier for the automatically calculated skirt height.
    pub skirt_exaggeration: f32,
    pub is_quantized_mesh: bool,
    pub geographic: bool,
    pub tms: bool,
}
/// The upsampled mesh returned by the worker, awaiting transfer to a tile
/// mesh. Holds non-reference-counted `BufferStore` handles: the consumer
/// (`transfer_mesh`) moves them into the spawned mesh and must mark the task
/// [`WorkerTaskResultConsumed`]; a result dropped without that marker (e.g.
/// its tile was torn down before transfer) frees its buffers via the
/// `on_remove` hook.
#[derive(Component, Clone, Debug, Serialize)]
#[component(on_remove = free_unconsumed_buffers::<UpsampleTerrainMeshResult>)]
pub struct UpsampleTerrainMeshResult {
    pub geometry: TransferableGeometry,
    pub heights: Handle,
    pub min_height: FloatType,
    pub max_height: FloatType,
    pub rtc_translation: Option<Vec3>,
    /// Watermask cropped from the parent tile's mask (1 byte uniform or
    /// 65536 byte 256x256 grid).
    pub watermask: Option<Handle>,
}

impl FreeResultBuffers for UpsampleTerrainMeshResult {
    fn remove_from_buf(&self, buf: &mut BufferStore) {
        self.geometry.remove_from_buf(buf);
        buf.remove(&self.heights);
        if let Some(watermask) = &self.watermask {
            buf.remove(watermask);
        }
    }
}

pub type UpsampleTerrainMeshWorkerTaskBundle =
    WorkerTaskBundle<UpsampleTerrainMeshMarker, UpsampleTerrainMeshParameters>;

#[cfg(test)]
mod test {
    use bevy_ecs::world::World;
    use navara_buffer_store::BufferStore;
    use navara_geometry::TransferableGeometry;

    use super::UpsampleTerrainMeshResult;
    use crate::component::WorkerTaskResultConsumed;

    fn spawn_result(buf: &mut BufferStore) -> UpsampleTerrainMeshResult {
        UpsampleTerrainMeshResult {
            geometry: TransferableGeometry {
                vertices: buf.new_f32(vec![0.]),
                uvs: buf.new_f32(vec![0.]),
                indices: buf.new_u32(vec![0]),
                normals: None,
                skirt_vertices: None,
                skirt_uvs: None,
                skirt_indices: None,
                skirt_normals: None,
            },
            heights: buf.new_f32(vec![0.]),
            min_height: 0.,
            max_height: 0.,
            rtc_translation: None,
            watermask: Some(buf.new_u8(vec![1])),
        }
    }

    /// A result whose tile was torn down before `transfer_mesh` consumed it
    /// must free its geometry and heights buffers on despawn.
    #[test]
    fn it_should_free_unconsumed_result_buffers_on_despawn() {
        let mut world = World::new();
        let mut buf = BufferStore::new();
        let result = spawn_result(&mut buf);
        assert_eq!(buf.len(), 5);
        world.insert_resource(buf);
        let e = world.spawn(result).id();

        world.despawn(e);

        assert!(world.resource::<BufferStore>().is_empty());
    }

    /// A consumed result's handles now belong to the tile mesh; despawning the
    /// task entity must leave them untouched.
    #[test]
    fn it_should_keep_transferred_buffers_when_result_was_consumed() {
        let mut world = World::new();
        let mut buf = BufferStore::new();
        let result = spawn_result(&mut buf);
        world.insert_resource(buf);
        let e = world.spawn((result, WorkerTaskResultConsumed)).id();

        world.despawn(e);

        assert_eq!(world.resource::<BufferStore>().len(), 5);
    }
}
