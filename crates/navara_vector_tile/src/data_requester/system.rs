use bevy_ecs::{
    entity::Entity,
    query::{Added, Has, Or, With, Without},
    system::{Commands, Query, Res, ResMut},
};
use navara_component::{Deleted, Ignored, OrderByDistance, Priority, Requested, Waiting};
use navara_data_requester::{DataManager, DataRequester, send_data_request};
use navara_event_store::EventStore;
use navara_tile_component::{TileHandle, VectorTileQuadtree};
use navara_worker_component::WorkerLimits;
use rustc_hash::FxHashMap;

use crate::{VectorTileSourceResources, layer::tile_cache_manager::TileCacheManager};

use super::VectorTileDataRequesterMarker;

/// A source's entities: its first layer (the key of its memory reservations),
/// its quadtree and its cache manager.
#[derive(Clone, Copy)]
struct SourceEntities {
    layer: Entity,
    quadtree: Entity,
    tile_cache_manager: Entity,
}

/// The source a requester belongs to, through its cache manager's
/// `requested_tile_caches` slot.
fn source_of(
    sources: &[SourceEntities],
    tcs: &Query<&mut TileCacheManager>,
    e: Entity,
    handle: TileHandle,
) -> Option<SourceEntities> {
    sources.iter().copied().find(|s| {
        tcs.get(s.tile_cache_manager)
            .is_ok_and(|tc| tc.requested_tile_caches.get(&handle) == Some(&e))
    })
}

/// Admits pending vector tile requests into the request slots
/// (`RequestLimits::max_pendings`, shared by every vector source).
///
/// A request that gets no slot waits ([`Waiting`]) instead of being dropped,
/// and is sent once a slot frees: the traversal asks for a tile once, and the
/// tile keeps its requester. A waiting request is ranked by what the last
/// traversal asked for its tile (`TileCacheManager::wanted_data`), and is
/// dropped once the traversal stops asking. Within a priority, the slots go
/// round-robin across sources, counting the ones each source already has in
/// flight, so no source is starved by the order the sources are traversed in.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn filter_requestable_data_requester(
    mut commands: Commands,
    mut events: ResMut<EventStore>,
    mut data_manager: ResMut<DataManager>,
    worker_limits: Option<Res<WorkerLimits>>,
    layers: Query<(Entity, &VectorTileSourceResources)>,
    mut qts: Query<&mut VectorTileQuadtree>,
    mut tcs: Query<&mut TileCacheManager>,
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
        (Entity, &VectorTileDataRequesterMarker),
        (With<DataRequester>, With<Requested>, Without<Deleted>),
    >,
    limits: Res<navara_data_requester::RequestLimits>,
    pressure: Res<navara_memory::SsePressure>,
    ledger: Res<navara_memory::MemoryLedger>,
) {
    let mut sources: Vec<SourceEntities> = vec![];
    for (layer, resources) in &layers {
        if sources
            .iter()
            .all(|s| s.tile_cache_manager != resources.tile_cache_manager)
        {
            sources.push(SourceEntities {
                layer,
                quadtree: resources.quadtree,
                tile_cache_manager: resources.tile_cache_manager,
            });
        }
    }
    let traversed = sources.iter().any(|s| {
        tcs.get(s.tile_cache_manager)
            .is_ok_and(|tc| tc.is_updated_in_this_frame)
    });

    // Load gate: when the memory budget is exhausted, start ZERO new fetches
    // and settle on the already-loaded tiles instead of evicting → refetching
    // in an endless loop. In-flight requests proceed; the rest wait.
    let free_slots = if pressure.load_gate_closed {
        0
    } else {
        (limits.max_pendings as usize).saturating_sub(requested_data_requesters.iter().count())
    };

    // Nothing can be sent, and no traversal changed what is wanted: only
    // hold the new requests.
    if free_slots == 0 && !traversed {
        for (e, .., waiting) in &data_requesters {
            if !waiting {
                commands.entity(e).try_insert(Waiting);
            }
        }
        return;
    }

    struct Candidate<'a> {
        entity: Entity,
        source: Option<SourceEntities>,
        data_req: &'a DataRequester,
        order: OrderByDistance,
        priority: Priority,
        waiting: bool,
    }

    let mut candidates: Vec<Candidate> = vec![];
    let mut unwanted: Vec<(Entity, SourceEntities, TileHandle)> = vec![];
    for (entity, marker, data_req, order, priority, waiting) in &data_requesters {
        if !data_req.is_pending() {
            continue;
        }
        let source = source_of(&sources, &tcs, entity, marker.0);
        let (order, priority) = match source {
            Some(s) => {
                let wanted = tcs
                    .get(s.tile_cache_manager)
                    .ok()
                    .and_then(|tc| tc.wanted_data.get(&marker.0).copied());
                let Some(priority) = wanted else {
                    unwanted.push((entity, s, marker.0));
                    continue;
                };
                // The tile was visited by the traversal that wants it, so its
                // screen-space error and distance are current.
                let order = qts
                    .get(s.quadtree)
                    .ok()
                    .and_then(|qt| qt.qt.get(marker.0))
                    .map_or_else(
                        || order.clone(),
                        |tile| OrderByDistance {
                            sse: tile.sse,
                            distance: tile.distance_from_camera,
                        },
                    );
                (order, priority)
            }
            None => (order.clone(), *priority),
        };
        candidates.push(Candidate {
            entity,
            source,
            data_req,
            order,
            priority,
            waiting,
        });
    }

    // The traversal no longer asks for these tiles: drop their requests, as
    // it would ask again with a fresh one.
    for (e, source, handle) in unwanted {
        if let Ok(mut tc) = tcs.get_mut(source.tile_cache_manager) {
            tc.requested_tile_caches.remove(&handle);
        }
        if let Ok(mut qt) = qts.get_mut(source.quadtree)
            && let Some(tile) = qt.qt.get_mut(handle)
            && tile.data_requester_entity_id == Some(e)
        {
            tile.data_requester_entity_id = None;
        }
        commands.entity(e).try_insert((Deleted, Ignored));
    }

    if free_slots == 0 {
        for c in candidates.iter().filter(|c| !c.waiting) {
            commands.entity(c.entity).try_insert(Waiting);
        }
        return;
    }

    // Round-robin across sources within a priority: the n-th request of
    // every source goes before any source's (n+1)-th, counting the requests a
    // source already has in flight.
    let mut in_flight: FxHashMap<Entity, usize> = FxHashMap::default();
    for (e, marker) in &requested_data_requesters {
        if let Some(s) = source_of(&sources, &tcs, e, marker.0) {
            *in_flight.entry(s.layer).or_default() += 1;
        }
    }
    candidates.sort_by(|a, b| {
        a.priority
            .rank()
            .cmp(&b.priority.rank())
            .then_with(|| a.order.cmp(&b.order))
    });
    let mut taken: FxHashMap<(Option<Entity>, u8), usize> = FxHashMap::default();
    let mut ranked: Vec<(usize, Candidate)> = candidates
        .into_iter()
        .map(|c| {
            let source = c.source.map(|s| s.layer);
            let nth = taken
                .entry((source, c.priority.rank()))
                .or_insert_with(|| source.and_then(|s| in_flight.get(&s).copied()).unwrap_or(0));
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
            .then_with(|| a.order.cmp(&b.order))
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
                Some(s) => navara_memory::ReservedCost::for_key(
                    navara_memory::ReserveKey::VectorLayer(s.layer),
                ),
                // No resolvable layer → no EMA pool; reserve the flat seed.
                None => navara_memory::ReservedCost::fixed(
                    navara_memory::DEFAULT_VECTOR_TILE_RESERVE_BYTES,
                ),
            };
            commands.entity(c.entity).try_insert(reservation);
        }

        // A new requester is sent by the senders this frame; a released one
        // is not seen by them any more, so send it here, at the priority its
        // tile is wanted at now.
        if c.waiting {
            commands
                .entity(c.entity)
                .remove::<Waiting>()
                .insert((c.priority, c.order));
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
    use bevy_ecs::world::Mut;
    use navara_data_requester::RequestLimits;
    use navara_memory::{MemoryLedger, SsePressure};

    fn spawn_requester(app: &mut App, priority: Priority, sse: f64) -> Entity {
        spawn_requester_of(app, None, 0, priority, sse)
    }

    /// A requester of `source`'s tile `handle`, registered in the source's
    /// cache manager as the traversal does, which also wants the tile.
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
            let mut tc = tile_cache_manager(app, source);
            tc.requested_tile_caches.insert(handle, e);
            tc.wanted_data.insert(handle, priority);
        }
        e
    }

    fn tile_cache_manager(app: &mut App, source: Entity) -> Mut<'_, TileCacheManager> {
        let tc_entity = app
            .world()
            .get::<VectorTileSourceResources>(source)
            .unwrap()
            .tile_cache_manager;
        app.world_mut()
            .get_mut::<TileCacheManager>(tc_entity)
            .unwrap()
    }

    /// A traversal of `source` ran this frame and wants exactly `wanted`.
    fn traverse(app: &mut App, source: Entity, wanted: &[(TileHandle, Priority)]) {
        let mut tc = tile_cache_manager(app, source);
        tc.is_updated_in_this_frame = true;
        tc.wanted_data = wanted.iter().copied().collect();
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

    /// A waiting request is ranked by the priority its tile is wanted at
    /// now, not the one it was spawned with.
    #[test]
    fn a_waiting_request_is_ranked_by_the_current_traversal() {
        let mut app = setup(true, 1);
        let a = spawn_source(&mut app, "a");
        // Requested while out of view, demoted.
        let panned_in = spawn_requester_of(&mut app, Some(a), 10, Priority::VeryLow, 1.0);
        app.update();
        assert!(is_waiting(&app, panned_in));

        // The camera pans: the tile is in view, and a new tile is wanted too.
        app.world_mut()
            .resource_mut::<SsePressure>()
            .load_gate_closed = false;
        let new = spawn_requester_of(&mut app, Some(a), 11, Priority::Low, 1.0);
        traverse(&mut app, a, &[(10, Priority::Medium), (11, Priority::Low)]);
        app.update();

        assert!(is_requested(&app, panned_in));
        assert_eq!(
            app.world().get::<Priority>(panned_in),
            Some(&Priority::Medium)
        );
        assert!(is_waiting(&app, new));
    }

    /// A waiting request whose tile the traversal no longer asks for is
    /// dropped instead of fetched later.
    #[test]
    fn a_waiting_request_is_dropped_when_its_tile_is_no_longer_wanted() {
        let mut app = setup(true, 1);
        let a = spawn_source(&mut app, "a");
        let e = spawn_requester_of(&mut app, Some(a), 10, Priority::Medium, 1.0);
        app.update();
        assert!(is_waiting(&app, e));

        // Still wanted while no traversal runs.
        app.update();
        assert!(app.world().get::<Deleted>(e).is_none());

        traverse(&mut app, a, &[]);
        app.update();
        assert!(app.world().get::<Deleted>(e).is_some());
        assert!(
            !tile_cache_manager(&mut app, a)
                .requested_tile_caches
                .contains_key(&10)
        );
    }

    /// The slots a source already holds count in the round-robin: a freed
    /// slot goes to the source with fewer in flight.
    #[test]
    fn requests_in_flight_count_in_the_round_robin() {
        let mut app = setup(false, 2);
        let a = spawn_source(&mut app, "a");
        let b = spawn_source(&mut app, "b");
        let in_flight = spawn_requester_of(&mut app, Some(a), 10, Priority::Medium, 1.0);
        app.world_mut().entity_mut(in_flight).insert(Requested);
        let a_next = spawn_requester_of(&mut app, Some(a), 11, Priority::Medium, 2.0);
        let b_next = spawn_requester_of(&mut app, Some(b), 20, Priority::Medium, 1.0);
        app.update();

        assert!(is_waiting(&app, a_next));
        assert!(!is_waiting(&app, b_next));
    }
}
