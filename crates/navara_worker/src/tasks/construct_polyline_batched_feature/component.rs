use bevy_ecs::{component::Component, entity::Entity};
use navara_buffer_store::BufferStore;
use navara_core::{Extent, Radians};
use navara_feature_component::render::TransferablePolylineGeometry;
use navara_math::FloatType;

use crate::component::{FreeResultBuffers, WorkerTaskBundle, free_unconsumed_buffers};

#[derive(Component)]
pub struct ConstructPolylineBatchedFeatureMarker;

#[derive(Component, Clone, Debug)]
pub struct ConstructPolylineBatchedFeatureParameters {
    pub batched_feature: Entity,
    /// If it's true, the polyline will be constructed in flat.
    /// This is used to render the polyline as a texture.
    pub flat: bool,
    pub tile_extent: Option<Extent<FloatType, Radians>>,
}

/// The tessellated polyline returned by the worker, awaiting transfer to a
/// `RenderableFeature`. Holds non-reference-counted `BufferStore` handles: the
/// consumer (`transfer_batched_mesh`) shares them with the spawned feature and
/// must mark the task [`WorkerTaskResultConsumed`]; a result dropped without
/// that marker (e.g. its `BatchedFeature` died before transfer) frees its
/// buffers via the `on_remove` hook.
#[derive(Component, Clone, Debug)]
#[component(on_remove = free_unconsumed_buffers::<ConstructPolylineBatchedFeatureResult>)]
pub struct ConstructPolylineBatchedFeatureResult {
    pub extent: Extent<FloatType, Radians>,
    pub geometry: TransferablePolylineGeometry,
}

impl FreeResultBuffers for ConstructPolylineBatchedFeatureResult {
    fn remove_from_buf(&self, buf: &mut BufferStore) {
        // `remove_buffers` takes `&mut self` but the geometry holds only
        // handles, so cloning is cheap. The returned batch ids are per-vertex
        // copies owned by the delegator feature — see `FreeResultBuffers`.
        self.geometry.clone().remove_buffers(buf);
    }
}

pub type ConstructPolylineBatchedFeatureWorkerTaskBundle = WorkerTaskBundle<
    ConstructPolylineBatchedFeatureMarker,
    ConstructPolylineBatchedFeatureParameters,
>;

#[cfg(test)]
mod test {
    use bevy_ecs::world::World;
    use navara_buffer_store::BufferStore;
    use navara_core::{Angle, Extent};
    use navara_feature_component::render::TransferablePolylineGeometry;
    use navara_geometry::TransferableFloatAttribute;

    use super::ConstructPolylineBatchedFeatureResult;
    use crate::component::WorkerTaskResultConsumed;

    fn spawn_result(buf: &mut BufferStore) -> ConstructPolylineBatchedFeatureResult {
        ConstructPolylineBatchedFeatureResult {
            extent: Extent {
                west: Angle::new(0.),
                south: Angle::new(0.),
                east: Angle::new(0.),
                north: Angle::new(0.),
            },
            geometry: TransferablePolylineGeometry {
                position: TransferableFloatAttribute {
                    data: buf.new_f32(vec![0.]),
                    size: 3,
                },
                position_high: None,
                position_low: None,
                start: None,
                start_high: None,
                start_low: None,
                forward_offset: None,
                end_high: None,
                end_low: None,
                start_normals: None,
                end_normal_and_texture_coordinate_normalization_x: None,
                right_normal_and_texture_coordinate_normalization_y: TransferableFloatAttribute {
                    data: buf.new_f32(vec![0.]),
                    size: 4,
                },
                batch_ids: None,
                batch_index: None,
                indices: buf.new_u32(vec![0]),
            },
        }
    }

    /// A result whose feature died before `transfer_batched_mesh` consumed it
    /// must free its geometry buffers on despawn.
    #[test]
    fn it_should_free_unconsumed_result_buffers_on_despawn() {
        let mut world = World::new();
        let mut buf = BufferStore::new();
        let result = spawn_result(&mut buf);
        assert_eq!(buf.len(), 3);
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

        assert_eq!(world.resource::<BufferStore>().len(), 3);
    }
}
