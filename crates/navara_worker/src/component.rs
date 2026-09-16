use bevy_ecs::{
    bundle::Bundle, component::Component, entity::Entity, lifecycle::HookContext,
    world::DeferredWorld,
};
use navara_buffer_store::BufferStore;

#[derive(Component)]
pub struct WorkerTaskMarker;

#[derive(Component)]
pub struct WorkerTaskDelegateeMarker(pub Entity);

#[derive(Component)]
pub struct WorkerTaskCompleted;

/// Marks a task result whose BufferStore handles were transferred to their
/// final owner (e.g. a tile mesh) by the consuming system. Result components
/// whose `on_remove` hook frees unconsumed buffers skip entities carrying this
/// marker, so consumers that take over handle ownership must insert it
/// together with `Deleted`.
#[derive(Component)]
pub struct WorkerTaskResultConsumed;

/// Frees every `BufferStore` handle a worker-task result owns. Implementing
/// this keeps the set of owned handles in ONE place per task: both the
/// component's `on_remove` hook and `handle_completed_event`'s
/// deleted-delegator path free through it, so a new handle field cannot be
/// freed on one path and leaked on the other.
///
/// Buffers only, never global batch ids: any batch ids in a result are
/// per-vertex COPIES of ids owned by the delegator feature's `GlobalBatchIds`,
/// released exactly once by its `remove_batched_feature`. A result outlives
/// that release by one or more frames, so releasing the copies here could free
/// an id the generator already re-issued to a live feature.
pub trait FreeResultBuffers: Component + Clone {
    fn remove_from_buf(&self, buf: &mut BufferStore);
}

/// Shared `on_remove` hook for result components: free the result's buffers
/// unless a consumer took over handle ownership (`WorkerTaskResultConsumed` —
/// consumption transfers/shares the live handles with the spawned mesh or
/// feature, so freeing unconditionally would destroy in-use data).
pub(crate) fn free_unconsumed_buffers<T: FreeResultBuffers>(
    mut world: DeferredWorld,
    ctx: HookContext,
) {
    if world.get::<WorkerTaskResultConsumed>(ctx.entity).is_some() {
        return;
    }
    let Some(result) = world.get::<T>(ctx.entity) else {
        return;
    };
    // Result components hold only handles and scalars, so this clone is cheap;
    // it releases the world borrow before taking the resource below.
    let result = result.clone();
    let Some(mut buf) = world.get_resource_mut::<BufferStore>() else {
        return;
    };
    result.remove_from_buf(&mut buf);
}

#[derive(Bundle)]
pub struct WorkerTaskBundle<Marker: Component, Parameters: Component> {
    pub marker: Marker,
    pub worker_task_marker: WorkerTaskMarker,
    pub parameters: Parameters,
}

impl<Marker: Component, Parameters: Component> WorkerTaskBundle<Marker, Parameters> {
    pub fn new(m: Marker, p: Parameters) -> Self {
        Self {
            marker: m,
            worker_task_marker: WorkerTaskMarker,
            parameters: p,
        }
    }
}
