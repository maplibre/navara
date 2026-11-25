use bevy_ecs::{
    component::Component,
    entity::Entity,
    query::{Added, Changed, With, Without},
    system::{Commands, Local, Query, Res, ResMut},
};

use navara_component::Deleted;
use navara_event_store::EventStore;

use navara_feature_component::render::RenderableFeature;
use navara_worker_component::WorkerLimits;

/// Budget for `renderable_feature_added` per frame, in [`add_cost`] units.
/// The frontend builds every emitted feature on its main thread in the frame
/// it arrives, and one parsed vector tile commits hundreds at once, so the
/// excess is held back ([`DeferredFeatureAdd`]) and emitted over the
/// following frames.
pub const FEATURE_ADD_BUDGET_PER_FRAME: usize = 24;

/// Main-thread cost of building `feature` on the frontend, relative to a
/// geometry feature: a model also parses its glTF and uploads its textures.
fn add_cost(feature: &RenderableFeature) -> usize {
    match feature {
        RenderableFeature::Model { .. } => 8,
        _ => 1,
    }
}

/// A feature whose `renderable_feature_added` has not been emitted yet: it
/// arrived past [`FEATURE_ADD_BUDGET_PER_FRAME`] in its frame, or it is a model
/// and the frontend paused worker intake ([`WorkerLimits::is_paused`]) —
/// building a model decodes Draco and creases normals on the worker pool,
/// which must drain to recycle. [`commit`] emits held-back adds ahead of new
/// ones once there is room, in the order they were held back (the number).
/// Query order is not that order: removing the marker moves the newest
/// held-back row into the freed one. A starved early add would keep a REPLACE
/// 3D Tiles parent on screen until the whole burst lands, since the parent is
/// replaced only once all its children are rendered.
///
/// A feature is emitted while any budget is left, even one that costs more
/// than what is left, so a stream of cheap adds can never starve a model.
#[derive(Component, PartialEq, Eq, PartialOrd, Ord)]
pub struct DeferredFeatureAdd(u64);

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn commit(
    mut commands: Commands,
    mut deferrals: Local<u64>,
    mut events: ResMut<EventStore>,
    worker_limits: Option<Res<WorkerLimits>>,
    added: Query<(Entity, &RenderableFeature), (Added<RenderableFeature>, Without<Deleted>)>,
    deferred: Query<(Entity, &RenderableFeature, &DeferredFeatureAdd), Without<Deleted>>,
    changed: Query<Entity, (Changed<RenderableFeature>, Without<DeferredFeatureAdd>)>,
    removed: Query<Entity, (With<RenderableFeature>, With<Deleted>)>,
) {
    let paused = worker_limits.is_some_and(|l| l.is_paused());
    let held_by_pause =
        |feature: &RenderableFeature| paused && matches!(feature, RenderableFeature::Model { .. });
    let mut room = FEATURE_ADD_BUDGET_PER_FRAME;
    for (e, feature, _) in deferred.iter().sort::<&DeferredFeatureAdd>() {
        if room == 0 {
            break;
        }
        if held_by_pause(feature) {
            continue;
        }
        room = room.saturating_sub(add_cost(feature));
        commands.entity(e).remove::<DeferredFeatureAdd>();
        events.renderable_feature_added.push(e);
    }
    for (e, feature) in &added {
        if room == 0 || held_by_pause(feature) {
            *deferrals += 1;
            commands.entity(e).insert(DeferredFeatureAdd(*deferrals));
        } else {
            room = room.saturating_sub(add_cost(feature));
            events.renderable_feature_added.push(e);
        }
    }
    // A change of a deferred add is carried by the add itself; one emitted in
    // the frame it is deferred is dropped by the frontend (no job yet).
    for e in &changed {
        events.renderable_feature_changed.push(e);
    }
    for e in &removed {
        events.renderable_feature_removed.push(e);
    }
}

pub fn despawn(
    mut commands: Commands,
    removed: Query<Entity, (With<RenderableFeature>, With<Deleted>)>,
) {
    for e in &removed {
        if let Ok(mut e) = commands.get_entity(e) {
            e.despawn();
        }
    }
}

#[cfg(test)]
mod test {
    use bevy_app::{App, PostUpdate};
    use bevy_ecs::entity::Entity;

    use super::*;

    fn model() -> RenderableFeature {
        RenderableFeature::Model {
            coordinates: Default::default(),
            crs: Default::default(),
            active: true,
            material: Default::default(),
            transform: Default::default(),
            feature_id: Entity::PLACEHOLDER,
            render_info: Default::default(),
            bin: None,
            metadata: None,
            geometry: Default::default(),
            aabb: Default::default(),
            feature_batch_id: 0,
            batch_length: 0,
        }
    }

    fn take_added(app: &mut App) -> Vec<Entity> {
        std::mem::take(
            &mut app
                .world_mut()
                .resource_mut::<EventStore>()
                .renderable_feature_added,
        )
    }

    /// While worker intake is paused a model add is held back (other kinds
    /// are not), and it is emitted once intake resumes.
    #[test]
    fn it_should_defer_model_adds_while_worker_intake_is_paused() {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.insert_resource(WorkerLimits {
            intake_paused: true,
            ..Default::default()
        });
        app.add_systems(PostUpdate, commit);

        let model = app.world_mut().spawn(model()).id();
        let other = app.world_mut().spawn(RenderableFeature::Unknown).id();
        app.update();
        assert_eq!(take_added(&mut app), vec![other]);
        assert!(app.world().entity(model).contains::<DeferredFeatureAdd>());

        app.update();
        assert!(take_added(&mut app).is_empty());

        app.world_mut().resource_mut::<WorkerLimits>().intake_paused = false;
        app.update();
        assert_eq!(take_added(&mut app), vec![model]);
        assert!(!app.world().entity(model).contains::<DeferredFeatureAdd>());

        app.update();
        assert!(take_added(&mut app).is_empty());
    }

    /// A burst of adds past the per-frame cap drains over the following
    /// frames, held-back adds going out before newer ones.
    #[test]
    fn it_should_cap_adds_per_frame_and_drain_the_rest_in_order() {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.add_systems(PostUpdate, commit);

        let cap = FEATURE_ADD_BUDGET_PER_FRAME;
        let burst: Vec<Entity> = (0..cap * 2 + 1)
            .map(|_| app.world_mut().spawn(RenderableFeature::Unknown).id())
            .collect();
        app.update();
        let first = take_added(&mut app);
        assert_eq!(first.len(), cap);
        assert_eq!(
            app.world_mut()
                .query_filtered::<Entity, With<DeferredFeatureAdd>>()
                .iter(app.world())
                .count(),
            cap + 1
        );

        // A newer add waits behind the held-back ones.
        let late = app.world_mut().spawn(RenderableFeature::Unknown).id();
        app.update();
        let second = take_added(&mut app);
        assert_eq!(second.len(), cap);
        assert!(!second.contains(&late));

        app.update();
        let third = take_added(&mut app);
        assert_eq!(third.len(), 2);
        assert!(third.contains(&late));

        let mut emitted: Vec<Entity> = [first, second, third].concat();
        emitted.sort();
        let mut expected = burst;
        expected.push(late);
        expected.sort();
        assert_eq!(emitted, expected);

        app.update();
        assert!(take_added(&mut app).is_empty());
    }

    /// Held-back adds go out in arrival order even while new adds keep
    /// arriving every frame.
    #[test]
    fn it_should_drain_held_back_adds_in_arrival_order_while_adds_keep_arriving() {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.add_systems(PostUpdate, commit);

        let mut spawned = vec![];
        let mut emitted = vec![];
        for frame in 0..8 {
            if frame < 4 {
                for _ in 0..FEATURE_ADD_BUDGET_PER_FRAME * 2 {
                    spawned.push(app.world_mut().spawn(RenderableFeature::Unknown).id());
                }
            }
            app.update();
            emitted.extend(take_added(&mut app));
        }
        assert_eq!(emitted, spawned);
    }

    /// A model spends more of the budget than a geometry feature, and the last
    /// unit of the budget still admits one.
    #[test]
    fn it_should_spend_the_budget_by_add_cost() {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.add_systems(PostUpdate, commit);

        let per_frame = FEATURE_ADD_BUDGET_PER_FRAME / add_cost(&model());
        let models: Vec<Entity> = (0..per_frame + 1)
            .map(|_| app.world_mut().spawn(model()).id())
            .collect();
        app.update();
        assert_eq!(take_added(&mut app), models[..per_frame]);

        app.update();
        assert_eq!(take_added(&mut app), models[per_frame..]);

        let cheap: Vec<Entity> = (0..FEATURE_ADD_BUDGET_PER_FRAME - 1)
            .map(|_| app.world_mut().spawn(RenderableFeature::Unknown).id())
            .collect();
        let last = app.world_mut().spawn(model()).id();
        app.update();
        let mut expected = cheap;
        expected.push(last);
        assert_eq!(take_added(&mut app), expected);
    }

    /// A held-back add that is deleted before it is emitted is dropped, not
    /// emitted after its removal.
    #[test]
    fn it_should_drop_a_deferred_add_that_was_deleted() {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.add_systems(PostUpdate, commit);

        for _ in 0..FEATURE_ADD_BUDGET_PER_FRAME {
            app.world_mut().spawn(RenderableFeature::Unknown);
        }
        let held = app.world_mut().spawn(RenderableFeature::Unknown).id();
        app.update();
        assert!(!take_added(&mut app).contains(&held));

        app.world_mut().entity_mut(held).insert(Deleted);
        app.update();
        assert!(take_added(&mut app).is_empty());
        assert_eq!(
            app.world_mut()
                .resource_mut::<EventStore>()
                .renderable_feature_removed,
            vec![held]
        );
    }

    /// A feature added and deleted in the same frame spends no budget: only
    /// its removal goes out, and live adds of that frame are not deferred.
    #[test]
    fn it_should_not_spend_the_budget_on_an_add_deleted_in_the_same_frame() {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.add_systems(PostUpdate, commit);

        let gone = app
            .world_mut()
            .spawn((RenderableFeature::Unknown, Deleted))
            .id();
        let live: Vec<Entity> = (0..FEATURE_ADD_BUDGET_PER_FRAME)
            .map(|_| app.world_mut().spawn(RenderableFeature::Unknown).id())
            .collect();
        app.update();
        assert_eq!(take_added(&mut app), live);
        assert!(!app.world().entity(gone).contains::<DeferredFeatureAdd>());
        assert_eq!(
            app.world_mut()
                .resource_mut::<EventStore>()
                .renderable_feature_removed,
            vec![gone]
        );
    }
}
