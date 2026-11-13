use bevy_ecs::{
    entity::Entity,
    query::{Added, Has, Or, With, Without},
    system::{Commands, Query, Res},
};
use navara_component::{Deleted, Ignored, OrderByDistance, Priority, Requested, Resumed, Waiting};
use navara_data_requester::DataRequester;
use navara_tile_component::{TileHandle, VectorTileQuadtree};
use rustc_hash::FxHashMap;

use crate::{
    VectorTileSourceResources, layer::tile_cache_manager::TileCacheManager, source::TileSource,
    tile::system::remove_unvisited_tile,
};

use super::VectorTileDataRequesterMarker;

/// A source's entities: the source itself (also the key of its memory
/// reservations), its quadtree and its cache manager.
#[derive(Clone, Copy)]
struct SourceEntities {
    source: Entity,
    quadtree: Entity,
    tile_cache_manager: Entity,
}

/// The source whose cache manager holds `e` as the requester of its tile
/// `handle`. None once another request took the tile's slot.
fn source_of(
    sources: &Query<(Entity, &VectorTileSourceResources)>,
    tcs: &Query<&mut TileCacheManager>,
    e: Entity,
    handle: TileHandle,
) -> Option<SourceEntities> {
    sources.iter().find_map(|(source, resources)| {
        let tc = tcs.get(resources.tile_cache_manager).ok()?;
        (tc.requested_tile_caches.get(&handle) == Some(&e)).then_some(SourceEntities {
            source,
            quadtree: resources.quadtree,
            tile_cache_manager: resources.tile_cache_manager,
        })
    })
}

/// Admits pending vector tile requests into the request slots
/// (`RequestLimits::max_pendings`, shared by every vector source).
///
/// A request that gets no slot waits ([`Waiting`]) instead of being dropped,
/// and is [`Resumed`] once a slot frees, for the senders to send: the
/// traversal asks for a tile once, and the tile keeps its requester. A waiting
/// request is ranked by what the last traversal asked for its tile
/// (`TileCacheManager::wanted_data`), and is dropped once the traversal stops
/// asking. Within a priority, the slots go round-robin across sources,
/// counting the ones each source already has in flight, so no source is
/// starved by the order the sources are traversed in.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn filter_requestable_data_requester(
    mut commands: Commands,
    sources: Query<(Entity, &VectorTileSourceResources)>,
    mut qts: Query<&mut VectorTileQuadtree>,
    mut tcs: Query<&mut TileCacheManager>,
    mut tile_sources: Query<&mut TileSource>,
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
    let traversed = sources.iter().any(|(_, resources)| {
        tcs.get(resources.tile_cache_manager)
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

    struct Candidate {
        entity: Entity,
        source: SourceEntities,
        order: OrderByDistance,
        priority: Priority,
        is_current: bool,
        waiting: bool,
    }

    let mut candidates: Vec<Candidate> = vec![];
    for (entity, marker, data_req, order, priority, waiting) in &data_requesters {
        if !data_req.is_pending() {
            continue;
        }
        // No source holds it: another request took its tile's slot, so
        // nothing would ever use its data.
        let Some(source) = source_of(&sources, &tcs, entity, marker.0) else {
            commands.entity(entity).try_insert((Deleted, Ignored));
            continue;
        };
        let Ok(mut tc) = tcs.get_mut(source.tile_cache_manager) else {
            continue;
        };
        let Ok(mut qt) = qts.get_mut(source.quadtree) else {
            continue;
        };
        let handle = marker.0;

        // The traversal no longer asks for the tile: drop the request, as it
        // would ask again with a fresh one, and the tile's node with it once
        // it is out of view, as `clear_caches` does for requested tiles.
        let wanted = tc.wanted_data.get(&handle).copied();
        let Some(wanted) = wanted else {
            tc.requested_tile_caches.remove(&handle);
            if let Some(tile) = qt.qt.get_mut(handle)
                && tile.data_requester_entity_id == Some(entity)
            {
                tile.data_requester_entity_id = None;
            }
            remove_unvisited_tile(
                &mut commands,
                &mut qt,
                &tc,
                &mut tile_sources,
                source.source,
                handle,
            );
            commands.entity(entity).try_insert((Deleted, Ignored));
            continue;
        };

        // The tile was visited by the traversal that wants it, so its
        // screen-space error and distance are current.
        let wanted_order = qt.qt.get(handle).map_or_else(
            || order.clone(),
            |tile| OrderByDistance {
                sse: tile.sse,
                distance: tile.distance_from_camera,
            },
        );
        candidates.push(Candidate {
            entity,
            source,
            is_current: *priority == wanted && *order == wanted_order,
            order: wanted_order,
            priority: wanted,
            waiting,
        });
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
            *in_flight.entry(s.source).or_default() += 1;
        }
    }
    candidates.sort_by(|a, b| {
        a.priority
            .rank()
            .cmp(&b.priority.rank())
            .then_with(|| a.order.cmp(&b.order))
    });
    let mut taken: FxHashMap<(Entity, u8), usize> = FxHashMap::default();
    let mut ranked: Vec<(usize, Candidate)> = candidates
        .into_iter()
        .map(|c| {
            let nth = taken
                .entry((c.source.source, c.priority.rank()))
                .or_insert_with(|| in_flight.get(&c.source.source).copied().unwrap_or(0));
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
        let mut entity = commands.entity(c.entity);
        if i >= free_slots {
            if !c.waiting {
                entity.try_insert(Waiting);
            }
            continue;
        }

        // Reserve the per-source adaptive estimate (resolved by the `ReservedCost`
        // on_insert hook — EMA of previously landed geometry costs, seeded by the
        // vector constant while cold) for each requester actually dispatched this
        // frame.
        if ledger.enabled() {
            entity.try_insert(navara_memory::ReservedCost::for_key(
                navara_memory::ReserveKey::VectorLayer(c.source.source),
            ));
        }

        // The senders order the requests they send by priority: give each
        // the one its tile is wanted at now, which is what ranked it here.
        if !c.is_current {
            entity.try_insert((c.priority, c.order));
        }
        if c.waiting {
            entity.try_remove::<Waiting>().try_insert(Resumed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source_cache::{SourceId, TraversalConfig};
    use bevy_app::{App, PostUpdate, Update};
    use bevy_ecs::{resource::Resource, world::Mut};
    use navara_core::TileXYZ;
    use navara_data_requester::{
        DataManager, RequestLimits, send_data_request_events_with_priority,
    };
    use navara_event_store::EventStore;
    use navara_memory::{MemoryLedger, SsePressure};
    use navara_tile_component::VectorTile;

    /// The source `spawn_requester` puts its requests in.
    #[derive(Resource)]
    struct DefaultSource(Entity);

    /// A request of its own tile in the default source.
    fn spawn_requester(app: &mut App, priority: Priority, sse: f64) -> Entity {
        let source = app.world().resource::<DefaultSource>().0;
        let handle = 1000 + tile_cache_manager(app, source).requested_tile_caches.len();
        spawn_requester_of(app, source, handle as TileHandle, priority, sse)
    }

    /// A requester of `source`'s tile `handle`, registered in the source's
    /// cache manager as the traversal does, which also wants the tile.
    fn spawn_requester_of(
        app: &mut App,
        source: Entity,
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
        let mut tc = tile_cache_manager(app, source);
        tc.requested_tile_caches.insert(handle, e);
        tc.wanted_data.insert(handle, priority);
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

    fn quadtree(app: &mut App, source: Entity) -> Mut<'_, VectorTileQuadtree> {
        let qt_entity = app
            .world()
            .get::<VectorTileSourceResources>(source)
            .unwrap()
            .quadtree;
        app.world_mut()
            .get_mut::<VectorTileQuadtree>(qt_entity)
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

    /// The filter, then the sender the vector pipeline uses.
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
        app.add_systems(PostUpdate, send_data_request_events_with_priority);
        let source = spawn_source(&mut app, "default");
        app.insert_resource(DefaultSource(source));
        app
    }

    fn set_gate_closed(app: &mut App, closed: bool) {
        app.world_mut()
            .resource_mut::<SsePressure>()
            .load_gate_closed = closed;
    }

    fn sent(app: &App) -> Vec<Entity> {
        app.world().resource::<EventStore>().data_requested.clone()
    }

    fn is_waiting(app: &App, e: Entity) -> bool {
        app.world().get::<Waiting>(e).is_some()
    }

    fn is_requested(app: &App, e: Entity) -> bool {
        app.world().get::<Requested>(e).is_some()
    }

    fn is_deleted(app: &App, e: Entity) -> bool {
        app.world().get::<Deleted>(e).is_some()
    }

    #[test]
    fn closed_gate_holds_a_new_request() {
        let mut app = setup(true, 50);
        let e = spawn_requester(&mut app, Priority::High, 0.0);
        app.update();
        assert!(is_waiting(&app, e));
        assert!(!is_requested(&app, e));
        assert!(!is_deleted(&app, e));
    }

    #[test]
    fn open_gate_admits_a_new_request() {
        let mut app = setup(false, 50);
        let e = spawn_requester(&mut app, Priority::High, 0.0);
        app.update();
        assert!(!is_waiting(&app, e));
        assert!(is_requested(&app, e));
        assert_eq!(sent(&app), vec![e]);
    }

    /// A held request is sent once a slot frees.
    #[test]
    fn a_held_request_is_sent_when_a_slot_frees() {
        let mut app = setup(false, 1);
        let first = spawn_requester(&mut app, Priority::High, 2.0);
        let second = spawn_requester(&mut app, Priority::High, 1.0);
        app.update();
        assert!(is_requested(&app, first));
        assert!(is_waiting(&app, second));
        assert_eq!(sent(&app), vec![first]);

        // It holds the slot while pending.
        app.update();
        assert!(is_waiting(&app, second));

        // The slot frees when the first one lands.
        app.world_mut().entity_mut(first).remove::<Requested>();
        app.update();
        assert!(!is_waiting(&app, second));
        assert!(is_requested(&app, second));
        assert_eq!(sent(&app), vec![first, second]);
    }

    /// A released request and a new one are sent together, the more urgent
    /// first, whichever was waiting.
    #[test]
    fn released_and_new_requests_are_sent_in_priority_order() {
        let mut app = setup(true, 2);
        let source = app.world().resource::<DefaultSource>().0;
        let waiting = spawn_requester_of(&mut app, source, 10, Priority::Low, 1.0);
        app.update();
        assert!(is_waiting(&app, waiting));

        set_gate_closed(&mut app, false);
        let new = spawn_requester_of(&mut app, source, 11, Priority::High, 1.0);
        traverse(
            &mut app,
            source,
            &[(10, Priority::Low), (11, Priority::High)],
        );
        app.update();
        assert_eq!(sent(&app), vec![new, waiting]);
    }

    /// An admitted request, new or released, is sent at the priority its
    /// tile is wanted at now, which is what ranked it.
    #[test]
    fn an_admitted_request_carries_the_priority_its_tile_is_wanted_at() {
        let mut app = setup(false, 50);
        let source = app.world().resource::<DefaultSource>().0;
        let e = spawn_requester_of(&mut app, source, 10, Priority::Low, 1.0);
        traverse(&mut app, source, &[(10, Priority::High)]);
        app.update();
        assert!(is_requested(&app, e));
        assert_eq!(app.world().get::<Priority>(e), Some(&Priority::High));
    }

    /// Two sources, three equal requests each, two slots: each source gets
    /// one, whatever order they were spawned in.
    #[test]
    fn slots_are_shared_round_robin_across_sources() {
        let mut app = setup(false, 2);
        let a = spawn_source(&mut app, "a");
        let b = spawn_source(&mut app, "b");
        let a_requests: Vec<Entity> = (0..3)
            .map(|i| spawn_requester_of(&mut app, a, 10 + i, Priority::Medium, 1.0))
            .collect();
        let b_requests: Vec<Entity> = (0..3)
            .map(|i| spawn_requester_of(&mut app, b, 20 + i, Priority::Medium, 1.0))
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
        let a_high = spawn_requester_of(&mut app, a, 10, Priority::High, 1.0);
        let a_low = spawn_requester_of(&mut app, a, 11, Priority::Low, 1.0);
        let b_high = spawn_requester_of(&mut app, b, 20, Priority::High, 1.0);
        let b_low = spawn_requester_of(&mut app, b, 21, Priority::Low, 1.0);
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
        let panned_in = spawn_requester_of(&mut app, a, 10, Priority::VeryLow, 1.0);
        app.update();
        assert!(is_waiting(&app, panned_in));

        // The camera pans: the tile is in view, and a new tile is wanted too.
        set_gate_closed(&mut app, false);
        let new = spawn_requester_of(&mut app, a, 11, Priority::Low, 1.0);
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
        let e = spawn_requester_of(&mut app, a, 10, Priority::Medium, 1.0);
        app.update();
        assert!(is_waiting(&app, e));

        // Still wanted while no traversal runs.
        app.update();
        assert!(!is_deleted(&app, e));

        traverse(&mut app, a, &[]);
        app.update();
        assert!(is_deleted(&app, e));
        assert!(
            !tile_cache_manager(&mut app, a)
                .requested_tile_caches
                .contains_key(&10)
        );
    }

    /// The node of a dropped request's tile goes with it once the traversal
    /// no longer visits the tile, as `clear_caches` does for requested tiles;
    /// a tile still visited keeps its node.
    #[test]
    fn a_dropped_request_takes_its_tile_node_out_of_view_with_it() {
        let mut app = setup(true, 1);
        let a = spawn_source(&mut app, "a");
        let handles: Vec<TileHandle> = {
            let mut qt = quadtree(&mut app, a);
            qt.qt
                .initialize_zero(&|(x, y, z)| VectorTile::new(TileXYZ { x, y, z }, 0., 0.));
            let root = qt.qt.zero().unwrap().handle();
            let children = qt
                .qt
                .initialize_children((0, 0, 0), &|(x, y, z)| {
                    VectorTile::new(TileXYZ { x, y, z }, 0., 0.)
                })
                .unwrap();
            qt.qt.get_mut(root).unwrap().visited_at = 5;
            for child in &children {
                qt.qt.get_mut(*child).unwrap().visited_at = 4;
            }
            vec![root, children[0]]
        };
        let (visited, left) = (handles[0], handles[1]);
        let visited_request = spawn_requester_of(&mut app, a, visited, Priority::Medium, 1.0);
        let left_request = spawn_requester_of(&mut app, a, left, Priority::Medium, 1.0);
        app.update();

        tile_cache_manager(&mut app, a).last_rendered_frame = 5;
        traverse(&mut app, a, &[]);
        app.update();

        assert!(is_deleted(&app, visited_request));
        assert!(is_deleted(&app, left_request));
        let qt = quadtree(&mut app, a);
        assert!(qt.qt.get(visited).is_some());
        assert!(qt.qt.get(left).is_none());
    }

    /// A request that lost its tile's slot to a newer one for the same tile
    /// is dropped: nothing would ever take its data.
    #[test]
    fn a_request_no_source_holds_is_dropped() {
        let mut app = setup(true, 1);
        let a = spawn_source(&mut app, "a");
        let replaced = spawn_requester_of(&mut app, a, 10, Priority::Medium, 1.0);
        let current = spawn_requester_of(&mut app, a, 10, Priority::Medium, 1.0);
        traverse(&mut app, a, &[(10, Priority::Medium)]);
        app.update();

        assert!(is_deleted(&app, replaced));
        assert!(!is_deleted(&app, current));
        assert!(is_waiting(&app, current));
    }

    /// The slots a source already holds count in the round-robin: a freed
    /// slot goes to the source with fewer in flight.
    #[test]
    fn requests_in_flight_count_in_the_round_robin() {
        let mut app = setup(false, 2);
        let a = spawn_source(&mut app, "a");
        let b = spawn_source(&mut app, "b");
        let in_flight = spawn_requester_of(&mut app, a, 10, Priority::Medium, 1.0);
        app.world_mut().entity_mut(in_flight).insert(Requested);
        let a_next = spawn_requester_of(&mut app, a, 11, Priority::Medium, 2.0);
        let b_next = spawn_requester_of(&mut app, b, 20, Priority::Medium, 1.0);
        app.update();

        assert!(is_waiting(&app, a_next));
        assert!(!is_waiting(&app, b_next));
    }
}
