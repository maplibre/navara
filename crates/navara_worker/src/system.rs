use bevy_ecs::{
    entity::Entity,
    message::MessageReader,
    query::{Added, Has, Or, With, Without},
    system::{Commands, Query, ResMut},
};
use navara_buffer_store::BufferStore;
use navara_component::{Deleted, Priority};
use navara_event_store::EventStore;

use crate::{
    DelegatedWorkerTask, DelegatedWorkerTaskMarker, DelegatedWorkerTasksResult,
    WorkerTaskCompleted, WorkerTaskCompletedEvent, WorkerTaskDelegateeMarker,
    WorkerTaskFailedEvent,
    component::{FreeResultBuffers, WorkerTaskMarker},
};

/// Emit the dispatch event for newly delegated tasks, most urgent first: the
/// platform dispatches the stack in order, so within a frame a terrain mesh
/// (`High`) reaches a worker before an MVT parse (`Medium`). Tasks that could
/// not be dispatched this frame are re-ordered against newer ones on the
/// platform side, which reads the same priority off the event. The matching
/// removal event is emitted by [`remove`] at the despawn point, so a deletion
/// can never slip past the event.
#[allow(clippy::type_complexity)]
pub fn commit(
    mut events: ResMut<EventStore>,
    added: Query<(Entity, &Priority), (Added<DelegatedWorkerTaskMarker>, Without<Deleted>)>,
) {
    for (e, _) in added.iter().sort::<&Priority>() {
        events.worker_task_delegated.push(e);
    }
}

#[allow(clippy::type_complexity)]
pub fn handle_completed_event(
    mut commands: Commands,
    mut loaded_ev: MessageReader<WorkerTaskCompletedEvent>,
    mut buf: ResMut<BufferStore>,
    constructors: Query<
        Entity,
        (
            With<WorkerTaskMarker>,
            Without<WorkerTaskCompleted>,
            Without<Deleted>,
        ),
    >,
) {
    for e in loaded_ev.read() {
        // One body per task kind, differing only in the result type: deliver
        // the result to a live delegator, or — when the task was deleted
        // before completion — free the result's buffers through the same
        // `FreeResultBuffers` impl the component's `on_remove` hook uses, so
        // the set of owned handles cannot drift between the two paths.
        macro_rules! settle {
            ($delegator_id:expr, $value:expr) => {
                if constructors.contains(*$delegator_id) {
                    commands
                        .entity(*$delegator_id)
                        .insert(($value.clone(), WorkerTaskCompleted));
                } else {
                    $value.remove_from_buf(&mut buf);
                    continue;
                }
            };
        }
        match &e.result {
            DelegatedWorkerTasksResult::ConstructTerrainMesh(DelegatedWorkerTask {
                delegator_id,
                value,
            }) => settle!(delegator_id, value),
            DelegatedWorkerTasksResult::UpsampleTerrainMesh(DelegatedWorkerTask {
                delegator_id,
                value,
            }) => settle!(delegator_id, value),
            DelegatedWorkerTasksResult::ConstructPolygonBatchedFeature(DelegatedWorkerTask {
                delegator_id,
                value,
            }) => settle!(delegator_id, value),
            DelegatedWorkerTasksResult::ConstructPolylineBatchedFeature(DelegatedWorkerTask {
                delegator_id,
                value,
            }) => settle!(delegator_id, value),
            DelegatedWorkerTasksResult::ParseMvtTile(DelegatedWorkerTask {
                delegator_id,
                value,
            }) => settle!(delegator_id, value),
        }
        commands.entity(e.parameters_id).insert(Deleted);
    }
}

/// Release delegators whose delegated task failed on the platform side (see
/// [`WorkerTaskFailedEvent`]): mark them `Deleted` so [`remove`] tears them
/// down — delegatee included — and their pending dispatch slot frees. A
/// delegator already despawned (cancelled while the failure was in flight)
/// fails the entity lookup and is skipped.
pub fn handle_failed_event(
    mut commands: Commands,
    mut failed_ev: MessageReader<WorkerTaskFailedEvent>,
) {
    for e in failed_ev.read() {
        if let Ok(mut delegator) = commands.get_entity(e.delegator_id) {
            delegator.try_insert(Deleted);
        }
    }
}

/// Tear down deleted worker-task entities. Any unconsumed BufferStore handles
/// held by their result components are freed by the components' `on_remove`
/// hooks (see each task's `component.rs`), so this stays task-agnostic.
///
/// Deletion is propagated to the delegatee and the removal event is emitted
/// HERE, atomically with the despawn, and nowhere else. Doing either in a
/// separate system leaves a window — systems outside the worker chain apply
/// their `Deleted` inserts at arbitrary points between chained systems, so a
/// deletion landing between that system and this despawn would orphan the
/// delegatee (its in-flight worker-pool promise never aborted) or lose the
/// removal event.
#[allow(clippy::type_complexity)]
pub fn remove(
    mut commands: Commands,
    mut events: ResMut<EventStore>,
    constructors: Query<
        (
            Entity,
            Option<&WorkerTaskDelegateeMarker>,
            Has<DelegatedWorkerTaskMarker>,
        ),
        (
            With<Deleted>,
            Or<(With<WorkerTaskMarker>, With<DelegatedWorkerTaskMarker>)>,
        ),
    >,
) {
    for (e, delegatee, is_delegatee) in &constructors {
        if let Some(m) = delegatee
            && let Ok(mut de) = commands.get_entity(m.0)
        {
            // The delegatee is despawned on the next pass, once the Deleted
            // inserted here lands and its own removal event is emitted.
            // `try_insert`: when the delegatee is itself Deleted in this same
            // pass (e.g. a cancel marked both) and was iterated first, its
            // queued despawn applies before this insert; a plain `insert`
            // would panic on the despawned entity.
            de.try_insert(Deleted);
        }
        if is_delegatee {
            events.worker_task_removed.push(e);
        }
        commands.entity(e).despawn();
    }
}

#[cfg(test)]
mod test {
    use bevy_ecs::message::Messages;
    use bevy_ecs::system::RunSystemOnce;
    use bevy_ecs::world::World;
    use navara_component::Deleted;
    use navara_event_store::EventStore;

    use crate::{
        DelegatedWorkerTaskMarker, WorkerTaskDelegateeMarker, WorkerTaskFailedEvent,
        WorkerTaskMarker,
    };

    /// Within one frame the dispatch events come out most urgent first,
    /// whatever order the tasks were spawned in.
    #[test]
    fn it_should_emit_delegated_tasks_most_urgent_first() {
        use navara_component::Priority;

        let mut world = World::new();
        world.init_resource::<EventStore>();
        let medium = world
            .spawn((DelegatedWorkerTaskMarker, Priority::Medium))
            .id();
        let high = world
            .spawn((DelegatedWorkerTaskMarker, Priority::High))
            .id();
        let low = world.spawn((DelegatedWorkerTaskMarker, Priority::Low)).id();

        world.run_system_once(super::commit).unwrap();

        let events = world.resource::<EventStore>();
        assert_eq!(events.worker_task_delegated, vec![high, medium, low]);
    }

    /// A failure report must release the delegator: marking it `Deleted` lets
    /// the `remove` pass tear it down and free its pending dispatch slot.
    #[test]
    fn it_should_release_the_delegator_of_a_failed_task() {
        let mut world = World::new();
        world.init_resource::<Messages<WorkerTaskFailedEvent>>();
        let delegator = world.spawn(WorkerTaskMarker).id();
        world.write_message(WorkerTaskFailedEvent {
            delegator_id: delegator,
        });

        world.run_system_once(super::handle_failed_event).unwrap();

        assert!(world.entity(delegator).contains::<Deleted>());
    }

    /// A failure that raced a cancellation (the engine already despawned the
    /// delegator) must be ignored instead of panicking.
    #[test]
    fn it_should_ignore_a_failure_for_an_already_despawned_delegator() {
        let mut world = World::new();
        world.init_resource::<Messages<WorkerTaskFailedEvent>>();
        let delegator = world.spawn(WorkerTaskMarker).id();
        world.despawn(delegator);
        world.write_message(WorkerTaskFailedEvent {
            delegator_id: delegator,
        });

        world.run_system_once(super::handle_failed_event).unwrap();
    }

    /// Deleting a delegator must propagate to its delegatee at the despawn
    /// point, then emit the delegatee's removal event (so the JS worker pool
    /// aborts the in-flight promise) before the delegatee is despawned on the
    /// next pass.
    #[test]
    fn it_should_tear_down_the_delegatee_and_emit_its_removal_event() {
        let mut world = World::new();
        world.insert_resource(EventStore::default());
        let delegatee = world.spawn(DelegatedWorkerTaskMarker).id();
        let delegator = world
            .spawn((
                WorkerTaskMarker,
                WorkerTaskDelegateeMarker(delegatee),
                Deleted,
            ))
            .id();

        world.run_system_once(super::remove).unwrap();

        assert!(world.get_entity(delegator).is_err());
        assert!(world.entity(delegatee).contains::<Deleted>());
        // The delegator is not a delegated task; no removal event for it.
        assert!(
            world
                .resource::<EventStore>()
                .worker_task_removed
                .is_empty()
        );

        world.run_system_once(super::remove).unwrap();

        assert!(world.get_entity(delegatee).is_err());
        assert_eq!(
            world.resource::<EventStore>().worker_task_removed,
            vec![delegatee]
        );
    }

    /// When a cancel marks the delegator AND the delegatee `Deleted` in the
    /// same frame (as `cancel_evicted_parse_tasks` does), one `remove` pass
    /// handles both. The delegatee's archetype is created first so it is
    /// iterated first: its queued despawn applies before the delegator's
    /// Deleted propagation, which must therefore tolerate the already
    /// despawned target instead of panicking.
    #[test]
    fn it_should_survive_a_delegator_and_delegatee_deleted_in_the_same_pass() {
        let mut world = World::new();
        world.insert_resource(EventStore::default());
        let delegatee = world.spawn((DelegatedWorkerTaskMarker, Deleted)).id();
        let delegator = world
            .spawn((
                WorkerTaskMarker,
                WorkerTaskDelegateeMarker(delegatee),
                Deleted,
            ))
            .id();

        world.run_system_once(super::remove).unwrap();

        assert!(world.get_entity(delegator).is_err());
        assert!(world.get_entity(delegatee).is_err());
        assert_eq!(
            world.resource::<EventStore>().worker_task_removed,
            vec![delegatee]
        );
    }

    /// A delegator whose delegatee is already gone (e.g. torn down by
    /// `handle_completed_event` after a normal completion) must still despawn
    /// cleanly.
    #[test]
    fn it_should_despawn_a_delegator_whose_delegatee_is_already_gone() {
        let mut world = World::new();
        world.insert_resource(EventStore::default());
        let delegatee = world.spawn(DelegatedWorkerTaskMarker).id();
        world.despawn(delegatee);
        let delegator = world
            .spawn((
                WorkerTaskMarker,
                WorkerTaskDelegateeMarker(delegatee),
                Deleted,
            ))
            .id();

        world.run_system_once(super::remove).unwrap();

        assert!(world.get_entity(delegator).is_err());
    }
}
