use bevy_ecs::{component::Component, entity::Entity};
use navara_buffer_store::BufferStore;
use navara_core::{Extent, Radians};
use navara_feature_component::render::{
    TransferablePolygonGeometry, TransferablePolygonOutlineGeometry,
};
use navara_math::{FloatType, Vec3};

use crate::component::{FreeResultBuffers, WorkerTaskBundle, free_unconsumed_buffers};

#[derive(Component)]
pub struct ConstructPolygonBatchedFeatureMarker;

#[derive(Component, Clone, Debug)]
pub struct ConstructPolygonBatchedFeatureParameters {
    pub batched_feature: Entity,
    /// If it's true, the polygon will be constructed in flat.
    /// This is used to render the polygon as a texture.
    pub flat: bool,
    pub tile_extent: Option<Extent<FloatType, Radians>>,
}

/// The tessellated polygon returned by the worker, awaiting transfer to a
/// `RenderableFeature`. Holds non-reference-counted `BufferStore` handles: the
/// consumer (`transfer_batched_mesh`) shares them with the spawned feature and
/// must mark the task [`WorkerTaskResultConsumed`]; a result dropped without
/// that marker (e.g. its `BatchedFeature` died before transfer) frees its
/// buffers via the `on_remove` hook.
#[derive(Component, Clone, Debug)]
#[component(on_remove = free_unconsumed_buffers::<ConstructPolygonBatchedFeatureResult>)]
pub struct ConstructPolygonBatchedFeatureResult {
    pub extent: Option<Extent<FloatType, Radians>>,
    pub geometry: TransferablePolygonGeometry,
    pub outline_geometry: Option<TransferablePolygonOutlineGeometry>,
    /// RTC (Relative-To-Center) translation vector
    /// Contains the tile center in world-space ECEF coordinates
    pub rtc_translation: Option<Vec3>,
}

impl FreeResultBuffers for ConstructPolygonBatchedFeatureResult {
    fn remove_from_buf(&self, buf: &mut BufferStore) {
        // `remove_buffers` takes `&mut self` but the geometry holds only
        // handles, so cloning is cheap. The returned batch ids are per-vertex
        // copies owned by the delegator feature — see `FreeResultBuffers`.
        self.geometry.clone().remove_buffers(buf);
        if let Some(mut outline) = self.outline_geometry.clone() {
            outline.remove_from_buf(buf);
        }
    }
}

pub type ConstructPolygonBatchedFeatureWorkerTaskBundle = WorkerTaskBundle<
    ConstructPolygonBatchedFeatureMarker,
    ConstructPolygonBatchedFeatureParameters,
>;

#[cfg(test)]
mod test {
    use bevy_ecs::world::World;
    use navara_buffer_store::BufferStore;
    use navara_feature_component::render::TransferablePolygonGeometry;
    use navara_geometry::TransferableFloatAttribute;

    use super::ConstructPolygonBatchedFeatureResult;
    use crate::component::WorkerTaskResultConsumed;

    fn spawn_result(buf: &mut BufferStore) -> ConstructPolygonBatchedFeatureResult {
        ConstructPolygonBatchedFeatureResult {
            extent: None,
            geometry: TransferablePolygonGeometry {
                position: Some(TransferableFloatAttribute {
                    data: buf.new_f32(vec![0.]),
                    size: 3,
                }),
                position_3d_high: None,
                position_3d_low: None,
                normal: None,
                scale_normal_and_cap: None,
                batch_ids: None,
                batch_index: None,
                indices: buf.new_u32(vec![0]),
            },
            outline_geometry: None,
            rtc_translation: None,
        }
    }

    /// A result whose feature died before `transfer_batched_mesh` consumed it
    /// must free its geometry buffers on despawn.
    #[test]
    fn it_should_free_unconsumed_result_buffers_on_despawn() {
        let mut world = World::new();
        let mut buf = BufferStore::new();
        let result = spawn_result(&mut buf);
        assert_eq!(buf.len(), 2);
        world.insert_resource(buf);
        let e = world.spawn(result).id();

        world.despawn(e);

        assert!(world.resource::<BufferStore>().is_empty());
    }

    /// A consumed result's handles are shared with the rendered feature;
    /// despawning the task entity must leave them untouched.
    #[test]
    fn it_should_keep_transferred_buffers_when_result_was_consumed() {
        let mut world = World::new();
        let mut buf = BufferStore::new();
        let result = spawn_result(&mut buf);
        world.insert_resource(buf);
        let e = world.spawn((result, WorkerTaskResultConsumed)).id();

        world.despawn(e);

        assert_eq!(world.resource::<BufferStore>().len(), 2);
    }
}
