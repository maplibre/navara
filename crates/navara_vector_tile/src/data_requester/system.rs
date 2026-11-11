use bevy_ecs::{
    entity::Entity,
    query::{Added, Has, Or, With, Without},
    system::{Commands, Query, Res, ResMut},
};
use navara_component::{Deleted, OrderByDistance, Priority, Requested, Waiting};
use navara_data_requester::{DataManager, DataRequester, send_data_request};
use navara_event_store::EventStore;
use navara_worker_component::WorkerLimits;
use rustc_hash::FxHashMap;

use crate::{VectorTileSourceResources, layer::tile_cache_manager::TileCacheManager};

use super::VectorTileDataRequesterMarker;

/// Admits pending vector tile requests into the request slots
/// (`RequestLimits::max_pendings`, shared by every vector source).
///
/// A request that gets no slot waits ([`Waiting`]) instead of being dropped,
/// and is sent once a slot frees: the traversal asks for a tile once, and the
/// tile keeps its requester. Within a priority, every source gets its best
/// request in before any source gets its second, so no source is starved by
/// the order the sources are traversed in.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn filter_requestable_data_requester(
    mut commands: Commands,
    mut events: ResMut<EventStore>,
    mut data_manager: ResMut<DataManager>,
    worker_limits: Option<Res<WorkerLimits>>,
    layers: Query<(Entity, &VectorTileSourceResources)>,
    tcs: Query<&TileCacheManager>,
    data_requesters: Query<
        (
            Entity,
            &VectorTileDataRequesterMarker,
            &DataRequester,
            &OrderByDistance,
            &Priority,
            Has<Waiting>,
        ),
        (
            Or<(Added<VectorTileDataRequesterMarker>, With<Waiting>)>,
            Without<Requested>,
            Without<Deleted>,
        ),
    >,
    requested_data_requesters: Query<
        Entity,
        (
            With<VectorTileDataRequesterMarker>,
            With<DataRequester>,
            With<Requested>,
            Without<Deleted>,
        ),
    >,
    limits: Res<navara_data_requester::RequestLimits>,
    pressure: Res<navara_memory::SsePressure>,
    ledger: Res<navara_memory::MemoryLedger>,
) {
    let pendings = requested_data_requesters.iter().count();
    // Load gate: when the memory budget is exhausted, start ZERO new fetches
    // and settle on the already-loaded tiles instead of evicting → refetching
    // in an endless loop. In-flight requests proceed; the rest wait.
    let free_slots = if pressure.load_gate_closed {
        0
    } else {
        (limits.max_pendings as usize).saturating_sub(pendings)
    };

    // The source a requester belongs to, through its cache manager's
    // `requested_tile_caches` slot.
    let source_of = |e: Entity, marker: &VectorTileDataRequesterMarker| {
        layers.iter().find_map(|(layer_entity, layer)| {
            let tc = tcs.get(layer.tile_cache_manager).ok()?;
            (tc.requested_tile_caches.get(&marker.0) == Some(&e)).then_some(layer_entity)
        })
    };

    struct Candidate<'a> {
        entity: Entity,
        source: Option<Entity>,
        data_req: &'a DataRequester,
        order: &'a OrderByDistance,
        priority: Priority,
        waiting: bool,
    }

    let mut candidates: Vec<Candidate> = data_requesters
        .iter()
        .filter(|(_, _, data_req, _, _, _)| data_req.is_pending())
        .map(
            |(entity, marker, data_req, order, priority, waiting)| Candidate {
                entity,
                source: source_of(entity, marker),
                data_req,
                order,
                priority: *priority,
                waiting,
            },
        )
        .collect();

    // Round-robin across sources within a priority: the n-th best request of
    // every source goes before any source's (n+1)-th.
    candidates.sort_by(|a, b| {
        a.priority
            .rank()
            .cmp(&b.priority.rank())
            .then_with(|| a.order.cmp(b.order))
    });
    let mut taken: FxHashMap<(Option<Entity>, u8), usize> = FxHashMap::default();
    let mut ranked: Vec<(usize, Candidate)> = candidates
        .into_iter()
        .map(|c| {
            let nth = taken.entry((c.source, c.priority.rank())).or_default();
            let rank = *nth;
            *nth += 1;
            (rank, c)
        })
        .collect();
    ranked.sort_by(|(ra, a), (rb, b)| {
        a.priority
            .rank()
            .cmp(&b.priority.rank())
            .then(ra.cmp(rb))
            .then_with(|| a.order.cmp(b.order))
    });

    for (i, (_, c)) in ranked.into_iter().enumerate() {
        if i >= free_slots {
            if !c.waiting {
                commands.entity(c.entity).try_insert(Waiting);
            }
            continue;
        }

        // Reserve the per-layer adaptive estimate (resolved by the `ReservedCost`
        // on_insert hook — EMA of previously landed geometry costs, seeded by the
        // vector constant while cold) for each requester actually dispatched this
        // frame.
        if ledger.enabled() {
            let reservation = match c.source {
                Some(k) => {
                    navara_memory::ReservedCost::for_key(navara_memory::ReserveKey::VectorLayer(k))
                }
                // No resolvable layer → no EMA pool; reserve the flat seed.
                None => navara_memory::ReservedCost::fixed(
                    navara_memory::DEFAULT_VECTOR_TILE_RESERVE_BYTES,
                ),
            };
            commands.entity(c.entity).try_insert(reservation);
        }

        // A new requester is sent by the senders this frame; a released one
        // is not seen by them any more, so send it here.
        if c.waiting {
            commands.entity(c.entity).remove::<Waiting>();
            send_data_request(
                &mut commands,
                &mut events,
                &mut data_manager,
                worker_limits.as_deref(),
                c.entity,
                c.data_req,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source_cache::{SourceId, TraversalConfig};
    use bevy_app::{App, Update};
    use navara_data_requester::RequestLimits;
    use navara_memory::{MemoryLedger, SsePressure};
    use navara_tile_component::{TileHandle, VectorTileQuadtree};

    fn spawn_requester(app: &mut App, priority: Priority, sse: f64) -> Entity {
        spawn_requester_of(app, None, 0, priority, sse)
    }

    /// A requester of `source`'s tile `handle`, registered in the source's
    /// cache manager as the traversal does.
    fn spawn_requester_of(
        app: &mut App,
        source: Option<Entity>,
        handle: TileHandle,
        priority: Priority,
        sse: f64,
    ) -> Entity {
        let e = app
            .world_mut()
            .spawn((
                DataRequester::default(),
                VectorTileDataRequesterMarker(handle),
                OrderByDistance { sse, distance: 0.0 },
                priority,
            ))
            .id();
        if let Some(source) = source {
            let tc_entity = app
                .world()
                .get::<VectorTileSourceResources>(source)
                .unwrap()
                .tile_cache_manager;
            app.world_mut()
                .get_mut::<TileCacheManager>(tc_entity)
                .unwrap()
                .requested_tile_caches
                .insert(handle, e);
        }
        e
    }

    fn spawn_source(app: &mut App, key: &str) -> Entity {
        let world = app.world_mut();
        let quadtree = world.spawn(VectorTileQuadtree::new_with_linear_qt()).id();
        let tc = world.spawn(TileCacheManager::default()).id();
        world
            .spawn(VectorTileSourceResources::new(
                SourceId::new(key.to_string(), TraversalConfig::default()),
                quadtree,
                tc,
                vec![],
            ))
            .id()
    }

    fn setup(gate_closed: bool, max_pendings: u32) -> App {
        let mut app = App::new();
        app.insert_resource(RequestLimits { max_pendings });
        app.init_resource::<MemoryLedger>();
        app.init_resource::<navara_memory::ReserveEstimates>();
        app.init_resource::<EventStore>();
        app.init_resource::<DataManager>();
        app.insert_resource(SsePressure {
            multiplier: 1.0,
            load_gate_closed: gate_closed,
            ..Default::default()
        });
        app.add_systems(Update, filter_requestable_data_requester);
        app
    }

    fn is_waiting(app: &App, e: Entity) -> bool {
        app.world().get::<Waiting>(e).is_some()
    }

    fn is_requested(app: &App, e: Entity) -> bool {
        app.world().get::<Requested>(e).is_some()
    }

    #[test]
    fn closed_gate_holds_a_new_request() {
        let mut app = setup(true, 50);
        let e = spawn_requester(&mut app, Priority::High, 0.0);
        app.update();
        assert!(is_waiting(&app, e));
        assert!(app.world().get::<Deleted>(e).is_none());
    }

    #[test]
    fn open_gate_admits_a_new_request() {
        let mut app = setup(false, 50);
        let e = spawn_requester(&mut app, Priority::High, 0.0);
        app.update();
        assert!(!is_waiting(&app, e));
        assert!(app.world().get::<Deleted>(e).is_none());
    }

    /// A held request is sent once a slot frees, by the filter itself: the
    /// senders only take newly added requesters.
    #[test]
    fn a_held_request_is_sent_when_a_slot_frees() {
        let mut app = setup(false, 1);
        let first = spawn_requester(&mut app, Priority::High, 2.0);
        let second = spawn_requester(&mut app, Priority::High, 1.0);
        app.update();
        assert!(!is_waiting(&app, first));
        assert!(is_waiting(&app, second));
        assert!(
            app.world()
                .resource::<EventStore>()
                .data_requested
                .is_empty()
        );

        // The sender takes the admitted one; it holds the slot while pending.
        app.world_mut().entity_mut(first).insert(Requested);
        app.update();
        assert!(is_waiting(&app, second));

        // The slot frees when the first one lands.
        app.world_mut().entity_mut(first).remove::<Requested>();
        app.update();
        assert!(!is_waiting(&app, second));
        assert!(is_requested(&app, second));
        assert_eq!(
            app.world().resource::<EventStore>().data_requested,
            vec![second]
        );
    }

    /// Two sources, three equal requests each, two slots: each source gets
    /// one, whatever order they were spawned in.
    #[test]
    fn slots_are_shared_round_robin_across_sources() {
        let mut app = setup(false, 2);
        let a = spawn_source(&mut app, "a");
        let b = spawn_source(&mut app, "b");
        let a_requests: Vec<Entity> = (0..3)
            .map(|i| spawn_requester_of(&mut app, Some(a), 10 + i, Priority::Medium, 1.0))
            .collect();
        let b_requests: Vec<Entity> = (0..3)
            .map(|i| spawn_requester_of(&mut app, Some(b), 20 + i, Priority::Medium, 1.0))
            .collect();
        app.update();

        let admitted =
            |requests: &[Entity]| requests.iter().filter(|e| !is_waiting(&app, **e)).count();
        assert_eq!(admitted(&a_requests), 1);
        assert_eq!(admitted(&b_requests), 1);
    }

    /// Priority still comes first: a source's low request never jumps ahead
    /// of another source's high one.
    #[test]
    fn priority_outranks_the_round_robin() {
        let mut app = setup(false, 2);
        let a = spawn_source(&mut app, "a");
        let b = spawn_source(&mut app, "b");
        let a_high = spawn_requester_of(&mut app, Some(a), 10, Priority::High, 1.0);
        let a_low = spawn_requester_of(&mut app, Some(a), 11, Priority::Low, 1.0);
        let b_high = spawn_requester_of(&mut app, Some(b), 20, Priority::High, 1.0);
        let b_low = spawn_requester_of(&mut app, Some(b), 21, Priority::Low, 1.0);
        app.update();

        assert!(!is_waiting(&app, a_high));
        assert!(!is_waiting(&app, b_high));
        assert!(is_waiting(&app, a_low));
        assert!(is_waiting(&app, b_low));
    }
}
