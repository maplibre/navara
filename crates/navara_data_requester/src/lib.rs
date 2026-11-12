#![doc = include_str!("../README.md")]

mod data_manager;

use bevy_app::{PostUpdate, PreUpdate};
use bevy_ecs::{
    component::Component,
    entity::Entity,
    message::MessageReader,
    query::{Added, Or, With, Without},
    schedule::{IntoScheduleConfigs, SystemSet},
    system::{Commands, Query, Res, ResMut},
};
use navara_buffer_store::{BufferStore, BufferStoreFailedEvent, BufferStoreLoadedEvent, Handle};
use navara_component::{Deleted, Ignored, Priority, Requested, Resumed, Waiting};
use navara_event_store::EventStore;
use navara_worker_component::WorkerLimits;
use url::Url;

pub use data_manager::{DataManager, Unregistered};

pub struct DataRequesterPlugin;

/// System sets that order data-request dispatch within [`PostUpdate`].
///
/// A consumer crate that supplies its own priority/sort sender (such as
/// `navara_cesium3dtiles`'s distance-ordered sender) should register it in
/// [`DataRequesterSet::PrioritizeRequests`] rather than ordering against the
/// built-in sender directly. That set is chained before
/// [`DataRequesterSet::SendRequests`], so the deferred `Requested` insert
/// from the consumer's sender is flushed at the sync point Bevy inserts
/// between the two sets (auto-inserted because the consumer sender holds
/// `Commands`; enabled by default) before the built-in priority-only sender
/// runs. Without that boundary the same entity could be enqueued twice in
/// one frame.
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub enum DataRequesterSet {
    /// Consumer-provided priority/sort senders run here, ahead of the
    /// built-in senders in [`DataRequesterSet::SendRequests`].
    PrioritizeRequests,
    /// Built-in senders that enqueue data requests and apply load results.
    SendRequests,
}

/// Cap on in-flight (Requested) data fetches per tile pipeline
/// (raster fragments / terrain DEM / vector tiles / 3D Tiles content /
/// hillshade DEM each apply it independently). Configurable from JS via
/// `Core.setMaxPendingRequests` — mobile presets lower it to shrink the
/// decode/upload burst during camera moves.
#[derive(bevy_ecs::prelude::Resource, Debug, Clone, Copy)]
pub struct RequestLimits {
    pub max_pendings: u32,
}

impl Default for RequestLimits {
    fn default() -> Self {
        Self { max_pendings: 50 }
    }
}

/// An image fetch leader whose `data_requested` is held back while the
/// frontend paused worker intake ([`WorkerLimits::is_paused`]): the frontend
/// decodes images to pixels on its worker pool, which must drain to recycle.
/// [`release_deferred_data_requests`] emits it once intake resumes. The requester keeps `Requested`, so it still counts
/// against its pipeline's [`RequestLimits`] and the consumers sharing its
/// handle keep waiting on it.
#[derive(Component)]
pub struct DeferredDataRequest;

/// Emit `data_requested` for a fetch leader, or hold it back with
/// [`DeferredDataRequest`] while its payload would need a paused worker.
fn dispatch_fetch(
    commands: &mut Commands,
    events: &mut EventStore,
    worker_limits: Option<&WorkerLimits>,
    e: Entity,
    extension: &DataRequesterExtension,
) {
    if worker_limits.is_some_and(|l| l.is_paused()) && extension.is_image() {
        commands.entity(e).insert(DeferredDataRequest);
    } else {
        events.data_requested.push(e);
    }
}

/// Mark a pending requester `Requested` and dispatch its fetch, unless
/// another consumer of the same URL already did this frame.
fn send_data_request(
    commands: &mut Commands,
    events: &mut EventStore,
    data_manager: &mut DataManager,
    worker_limits: Option<&WorkerLimits>,
    e: Entity,
    data_req: &DataRequester,
) {
    if data_req.status != DataRequesterStatus::Pending {
        return;
    }
    commands.entity(e).insert(Requested);
    if data_manager.try_mark_fetch_enqueued(e) {
        dispatch_fetch(commands, events, worker_limits, e, &data_req.extension);
    }
}

impl bevy_app::Plugin for DataRequesterPlugin {
    fn build(&self, app: &mut bevy_app::App) {
        app.init_resource::<DataManager>()
            .init_resource::<RequestLimits>()
            .configure_sets(
                PostUpdate,
                (
                    DataRequesterSet::PrioritizeRequests,
                    DataRequesterSet::SendRequests,
                )
                    .chain(),
            )
            .add_systems(PreUpdate, remove_removed_data_requesters)
            .add_systems(
                PostUpdate,
                (
                    send_data_request_events,
                    send_data_request_events_with_priority,
                    release_deferred_data_requests,
                    set_data_requester_loaded,
                    set_data_requester_failed,
                    promote_fetch_leaders,
                    release_landed_reservations,
                )
                    .chain()
                    .in_set(DataRequesterSet::SendRequests),
            );
    }
}

#[derive(Default, Debug, Clone, PartialEq)]
pub enum DataRequesterStatus {
    #[default]
    Pending,
    Success,
    Fail,
}

#[derive(Debug, Clone, PartialEq, Default, Component)]
pub struct DataRequester {
    pub handle: Handle,
    pub url: String,
    pub extension: DataRequesterExtension,
    pub status: DataRequesterStatus,
    /// Whether this DataRequester's handle is managed by DataManager.
    /// If true, cleanup is handled via DataManager's refcounting.
    /// If false, handle cleanup is the responsibility of the owner.
    pub managed_by_data_manager: bool,
    /// Optional HTTP byte range as `(offset, length)`. When `Some`, the fetch
    /// issues a `Range: bytes=offset-(offset+length-1)` request instead of
    /// fetching the whole resource. `None` preserves the existing
    /// full-resource GET behavior, so every current caller is unaffected.
    pub byte_range: Option<(u64, u64)>,
    /// Quantized-mesh only: ask the server for oct-encoded per-vertex normals.
    /// Adds `octvertexnormals` to the Accept header for `.terrain` requests.
    pub request_vertex_normals: bool,
    /// Quantized-mesh only: ask the server for the watermask extension.
    /// Adds `watermask` to the Accept header for `.terrain` requests.
    pub request_water_mask: bool,
    /// Quantized-mesh only: bearer token sent as the `Authorization` header.
    /// `None` means no Authorization header is added.
    pub token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub enum DataRequesterExtension {
    #[default]
    Png,
    WebP,
    Json,
    B3dm,
    Pnts,
    Mvt,
    GeoJson,
    Glb,
    Gltf,
    Terrain,
}

impl DataRequesterExtension {
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(v: &str) -> Self {
        match v {
            "png" => Self::Png,
            "webp" => Self::WebP,
            "json" => Self::Json,
            "b3dm" => Self::B3dm,
            "pnts" => Self::Pnts,
            "mvt" => Self::Mvt,
            "geojson" => Self::GeoJson,
            "glb" => Self::Glb,
            "gltf" => Self::Gltf,
            "terrain" => Self::Terrain,
            _ => unimplemented!("{}", v),
        }
    }

    #[allow(clippy::inherent_to_string)]
    pub fn to_string(&self) -> String {
        match self {
            Self::Png => "png".to_string(),
            Self::WebP => "webp".to_string(),
            Self::Json => "json".to_string(),
            Self::B3dm => "b3dm".to_string(),
            Self::Pnts => "pnts".to_string(),
            Self::Mvt => "mvt".to_string(),
            Self::GeoJson => "geojson".to_string(),
            Self::Glb => "glb".to_string(),
            Self::Gltf => "gltf".to_string(),
            Self::Terrain => "terrain".to_string(),
        }
    }

    pub fn from_url(url: &Url) -> Self {
        match url.path() {
            v if v.ends_with("geojson") => Self::GeoJson,
            v if v.ends_with("json") => Self::Json,
            v if v.ends_with("b3dm") => Self::B3dm,
            v if v.ends_with("pnts") => Self::Pnts,
            v if v.ends_with("png") => Self::Png,
            v if v.contains(".glb") => Self::Glb,
            v if v.ends_with("gltf") => Self::Gltf,
            v if v.ends_with("webp") => Self::WebP,
            v if v.ends_with("terrain") => Self::Terrain,
            v => unimplemented!("The extension of {} isn't supported", v),
        }
    }

    /// An image payload, which the frontend decodes to pixels on its worker
    /// pool before storing it.
    pub fn is_image(&self) -> bool {
        matches!(self, Self::Png | Self::WebP)
    }
}

impl DataRequester {
    /// Create a DataRequester with an unmanaged handle.
    /// The caller is responsible for handle cleanup.
    pub fn new(handle: Handle, url: String, extension: DataRequesterExtension) -> Self {
        Self {
            handle,
            url,
            extension,
            status: DataRequesterStatus::default(),
            managed_by_data_manager: false,
            byte_range: None,
            request_vertex_normals: false,
            request_water_mask: false,
            token: None,
        }
    }

    /// Create a DataRequester with a DataManager-managed handle.
    /// Cleanup is handled via DataManager's refcounting.
    /// This should be used after calling `DataManager::register_consumer()`.
    pub fn new_with_status(
        handle: Handle,
        url: String,
        extension: DataRequesterExtension,
        status: DataRequesterStatus,
    ) -> Self {
        Self {
            handle,
            url,
            extension,
            status,
            managed_by_data_manager: true,
            byte_range: None,
            request_vertex_normals: false,
            request_water_mask: false,
            token: None,
        }
    }

    /// Attach an HTTP byte range (`offset`, `length`) to this request.
    ///
    /// Builder-style so existing construction sites stay unchanged; callers
    /// that need a partial fetch (e.g. PMTiles header / directory / tile
    /// reads) opt in explicitly.
    pub fn with_byte_range(mut self, offset: u64, length: u64) -> Self {
        self.byte_range = Some((offset, length));
        self
    }

    pub fn from_store(
        url: String,
        buf: &mut BufferStore,
        extension: DataRequesterExtension,
    ) -> Self {
        Self::new(buf.new_handle(), url, extension)
    }

    /// Builder-style setter for quantized-mesh extension flags.
    pub fn with_quantized_mesh_extensions(
        mut self,
        request_vertex_normals: bool,
        request_water_mask: bool,
    ) -> Self {
        self.request_vertex_normals = request_vertex_normals;
        self.request_water_mask = request_water_mask;
        self
    }

    /// Builder-style setter for the bearer token used in the `Authorization`
    /// header for `.terrain` requests.
    pub fn with_token(mut self, token: Option<String>) -> Self {
        self.token = token;
        self
    }

    pub fn is_succeeded(&self) -> bool {
        matches!(self.status, DataRequesterStatus::Success)
    }

    pub fn is_failed(&self) -> bool {
        matches!(self.status, DataRequesterStatus::Fail)
    }

    pub fn is_pending(&self) -> bool {
        matches!(self.status, DataRequesterStatus::Pending)
    }
}

pub fn set_data_requester_loaded(
    mut commands: Commands,
    mut events: MessageReader<BufferStoreLoadedEvent>,
    mut data_manager: ResMut<DataManager>,
    mut requests: Query<(Entity, &mut DataRequester), With<Requested>>,
) {
    for e in events.read() {
        let loaded_handle = e.handle;

        // Broadcast success to DataRequesters with matching handle.
        // Query filtered to With<Requested> for performance - all in-flight requests
        // have Requested marker (inserted by send_data_request_events), so this
        // skips already-successful DataRequesters while finding all pending ones.
        for (entity, mut data_req) in requests.iter_mut() {
            if data_req.handle == loaded_handle && data_req.status == DataRequesterStatus::Pending {
                commands.entity(entity).remove::<Requested>();
                data_req.status = DataRequesterStatus::Success;
                // The shared fetch settled: a later consumer that finds no
                // buffer must be able to dispatch again.
                data_manager.reset_fetch_enqueued(entity);
            }
        }
    }
}

pub fn set_data_requester_failed(
    mut commands: Commands,
    mut events: MessageReader<BufferStoreFailedEvent>,
    mut data_manager: ResMut<DataManager>,
    mut requests: Query<(Entity, &mut DataRequester), With<Requested>>,
) {
    for e in events.read() {
        // The report carries the handle: the requester may already be
        // despawned (and unregistered from DataManager) while the consumers
        // sharing its handle still wait. Handles are never reused, so this
        // cannot reach an unrelated fetch.
        let failed_handle = e.handle;

        // Broadcast failure to all consumers with the same handle.
        // This ensures all consumers sharing a handle are notified when any one fails,
        // preventing them from being stuck in Pending state forever.
        for (entity, mut data_req) in requests.iter_mut() {
            if data_req.handle == failed_handle && data_req.status == DataRequesterStatus::Pending {
                commands.entity(entity).remove::<Requested>();
                data_req.status = DataRequesterStatus::Fail;
            }
        }

        // Reset fetch_enqueued flag so future consumers can retry.
        // Without this, new consumers would see fetch_already_enqueued=true,
        // get Requested marker, but no fetch would actually happen.
        data_manager.reset_fetch_enqueued(e.id);
    }
}

/// Releases the dispatch-time [`ReservedCost`] the frame a fetch resolves.
///
/// A reservation stands in for a tile's cost only while the fetch is in flight.
/// Once the requester's status leaves `Pending` (success or fail), the actual
/// [`navara_memory::TileCost`] is about to land (a frame or so later, when the
/// pipeline parses the loaded payload). Removing the reservation here — before
/// that measured cost lands — keeps a reservation and its own tile's actual
/// cost from systematically double-counting: the worst case is a one-frame
/// conservative *under*-count between release and land, which is harmless (it
/// only briefly relaxes an already-early gate).
///
/// Abort paths (requester despawned while still `Pending`) don't reach here;
/// the `ReservedCost` `on_remove` hook releases those on despawn instead, so
/// every exit path is covered.
pub fn release_landed_reservations(
    mut commands: Commands,
    requesters: Query<(Entity, &DataRequester), With<navara_memory::ReservedCost>>,
) {
    for (entity, data_req) in requesters.iter() {
        if !data_req.is_pending() {
            commands
                .entity(entity)
                .remove::<navara_memory::ReservedCost>();
        }
    }
}

#[allow(clippy::type_complexity)]
pub fn send_data_request_events(
    mut commands: Commands,
    mut events: ResMut<EventStore>,
    mut data_manager: ResMut<DataManager>,
    worker_limits: Option<Res<WorkerLimits>>,
    requests: Query<
        (Entity, &DataRequester),
        (
            Or<(Added<DataRequester>, Added<Resumed>)>,
            Without<Priority>,
            Without<Deleted>,
            Without<Requested>,
            Without<Waiting>,
        ),
    >,
    removed: Query<Entity, (With<DataRequester>, With<Deleted>, Without<Ignored>)>,
) {
    for (e, data_req) in requests.iter() {
        send_data_request(
            &mut commands,
            &mut events,
            &mut data_manager,
            worker_limits.as_deref(),
            e,
            data_req,
        );
    }

    for e in removed.iter() {
        commands.entity(e).remove::<Requested>();
        events.data_requester_removed.push(e);
    }
}

#[allow(clippy::type_complexity)]
pub fn send_data_request_events_with_priority(
    mut commands: Commands,
    mut events: ResMut<EventStore>,
    mut data_manager: ResMut<DataManager>,
    worker_limits: Option<Res<WorkerLimits>>,
    requests: Query<
        (Entity, &Priority, &DataRequester),
        (
            Or<(Added<DataRequester>, Added<Resumed>)>,
            Without<Deleted>,
            Without<Requested>,
            Without<Waiting>,
        ),
    >,
) {
    for (e, _, data_req) in requests.iter().sort::<&Priority>() {
        send_data_request(
            &mut commands,
            &mut events,
            &mut data_manager,
            worker_limits.as_deref(),
            e,
            data_req,
        );
    }
}

/// Marker trait for a secondary sort key used by
/// [`send_data_request_events_with_priority_and_sort`]. Implementors are
/// wrapped in [`RequestOrder<K>`] and compared after `Priority`; smaller
/// values (per [`Ord`]) are enqueued earlier within the same priority.
pub trait RequestOrderKey: Component + Ord + Send + Sync + 'static {}

/// Wrapper component attached to a [`DataRequester`] to control its
/// position in the request queue. Smaller `K` values (per [`Ord`]) are
/// enqueued earlier within the same [`Priority`].
#[derive(Component, PartialEq, Eq, PartialOrd, Ord, Debug, Clone)]
pub struct RequestOrder<K: RequestOrderKey>(pub K);

/// Priority + secondary-sort version of [`send_data_request_events_with_priority`].
///
/// Requests with the highest [`Priority`] are sent first; ties are broken by
/// the wrapped [`RequestOrderKey`] (smaller first). Already-`Requested`
/// entities are skipped so this can run alongside the default senders.
/// Only Pending DataRequesters trigger fetch events.
#[allow(clippy::type_complexity)]
pub fn send_data_request_events_with_priority_and_sort<K: RequestOrderKey>(
    mut commands: Commands,
    mut events: ResMut<EventStore>,
    mut data_manager: ResMut<DataManager>,
    worker_limits: Option<Res<WorkerLimits>>,
    requests: Query<
        (Entity, &Priority, &RequestOrder<K>, &DataRequester),
        (
            Or<(Added<DataRequester>, Added<Resumed>)>,
            Without<Deleted>,
            Without<Requested>,
            Without<Waiting>,
        ),
    >,
) {
    for (e, _, _, data_req) in requests.iter().sort::<(&Priority, &RequestOrder<K>)>() {
        send_data_request(
            &mut commands,
            &mut events,
            &mut data_manager,
            worker_limits.as_deref(),
            e,
            data_req,
        );
    }
}

pub fn remove_removed_data_requesters(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    mut resource_manager: ResMut<DataManager>,
    removed: Query<(Entity, &DataRequester), With<Deleted>>,
) {
    for (e, d) in removed.iter() {
        if d.managed_by_data_manager {
            // Handle is managed by DataManager - use refcounting cleanup.
            // Note: unregister_consumer may return None if this entity was already
            // unregistered (e.g., by filter systems), which is fine - the handle
            // cleanup was already handled or is still shared by other consumers.
            // A removed leader's key is re-led by `promote_fetch_leaders`.
            if let Some(Unregistered {
                handle,
                last_consumer: true,
                ..
            }) = resource_manager.unregister_consumer(e)
            {
                buf.remove(&handle);
            }
        } else {
            // Handle is unmanaged - caller is responsible for cleanup
            buf.remove(&d.handle);
        }

        commands.entity(e).remove::<Requested>();
        commands.entity(e).despawn();
    }
}

/// Dispatch the fetch again for keys whose leader was removed while other
/// consumers still wait on it (the frontend aborts the removed leader's
/// fetch). A waiting follower already carries `Requested`, so the senders
/// never revisit it; this is the only path that re-emits it.
///
/// Runs after the load/fail systems so a follower whose result landed this
/// frame is no longer Pending and is not re-dispatched.
#[allow(clippy::type_complexity)]
pub fn promote_fetch_leaders(
    mut commands: Commands,
    mut events: ResMut<EventStore>,
    mut data_manager: ResMut<DataManager>,
    worker_limits: Option<Res<WorkerLimits>>,
    waiting: Query<(&DataRequester, Option<&Priority>), (With<Requested>, Without<Deleted>)>,
) {
    // Requests without `Priority` rank as `Extreme`, as on the frontend.
    let urgency = |e: Entity| {
        let (data_req, priority) = waiting.get(e).ok()?;
        (data_req.status == DataRequesterStatus::Pending).then(|| priority.map_or(0, |p| p.rank()))
    };
    let mut promoted = data_manager.promote_orphaned_leaders(urgency);
    promoted.sort_by_key(|&e| urgency(e));
    for e in promoted {
        if let Ok((data_req, _)) = waiting.get(e) {
            dispatch_fetch(
                &mut commands,
                &mut events,
                worker_limits.as_deref(),
                e,
                &data_req.extension,
            );
        }
    }
}

/// Emit the fetches held back by [`dispatch_fetch`] once worker intake
/// resumes, most urgent first (requests without `Priority` rank as
/// `Extreme`, as on the frontend).
#[allow(clippy::type_complexity)]
pub fn release_deferred_data_requests(
    mut commands: Commands,
    mut events: ResMut<EventStore>,
    worker_limits: Option<Res<WorkerLimits>>,
    deferred: Query<(Entity, Option<&Priority>), (With<DeferredDataRequest>, Without<Deleted>)>,
) {
    if worker_limits.is_some_and(|l| l.is_paused()) {
        return;
    }
    for (e, _) in deferred.iter().sort::<Option<&Priority>>() {
        commands.entity(e).remove::<DeferredDataRequest>();
        events.data_requested.push(e);
    }
}

#[cfg(test)]
mod leader_promotion_tests {
    use bevy_app::{App, PostUpdate, PreUpdate};

    use super::*;

    fn make_app() -> App {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.init_resource::<DataManager>();
        app.init_resource::<BufferStore>();
        app.add_systems(PreUpdate, remove_removed_data_requesters);
        app.add_message::<BufferStoreLoadedEvent>();
        app.add_message::<BufferStoreFailedEvent>();
        app.add_systems(
            PostUpdate,
            (
                send_data_request_events,
                release_deferred_data_requests,
                set_data_requester_loaded,
                set_data_requester_failed,
                promote_fetch_leaders,
            )
                .chain(),
        );
        app
    }

    /// Spawn a managed consumer of `url`; the first one dispatches, later ones
    /// wait on the same handle with `Requested` already set.
    fn spawn_consumer(app: &mut App, url: &str) -> Entity {
        spawn_consumer_of(app, url, DataRequesterExtension::Png)
    }

    fn spawn_consumer_of(app: &mut App, url: &str, extension: DataRequesterExtension) -> Entity {
        let world = app.world_mut();
        let entity = world.spawn_empty().id();
        let (handle, _, already_enqueued) =
            world.resource_scope(|world, mut dm: bevy_ecs::world::Mut<DataManager>| {
                let mut buf = world.resource_mut::<BufferStore>();
                dm.register_consumer(url.to_string(), None, entity, &mut buf)
            });
        let requester = DataRequester::new_with_status(
            handle,
            url.to_string(),
            extension,
            DataRequesterStatus::Pending,
        );
        if already_enqueued {
            world.entity_mut(entity).insert((requester, Requested));
        } else {
            world.entity_mut(entity).insert(requester);
        }
        entity
    }

    fn take_requested(app: &mut App) -> Vec<Entity> {
        let mut store = app.world_mut().resource_mut::<EventStore>();
        std::mem::take(&mut store.data_requested)
    }

    #[test]
    fn a_follower_redispatches_when_its_leader_is_removed() {
        let mut app = make_app();
        let leader = spawn_consumer(&mut app, "https://example.com/a.png");
        app.update();
        assert_eq!(take_requested(&mut app), vec![leader]);

        let follower = spawn_consumer(&mut app, "https://example.com/a.png");
        app.update();
        assert!(take_requested(&mut app).is_empty());

        app.world_mut().entity_mut(leader).insert(Deleted);
        app.update();
        assert_eq!(take_requested(&mut app), vec![follower]);
        assert!(app.world().get_entity(leader).is_err());

        // Removing the promoted follower (now the last consumer) orphans nobody.
        app.world_mut().entity_mut(follower).insert(Deleted);
        app.update();
        assert!(take_requested(&mut app).is_empty());
    }

    #[test]
    fn a_settled_follower_is_not_redispatched() {
        let mut app = make_app();
        let leader = spawn_consumer(&mut app, "https://example.com/b.png");
        let follower = spawn_consumer(&mut app, "https://example.com/b.png");
        app.update();
        assert_eq!(take_requested(&mut app), vec![leader]);

        app.world_mut()
            .get_mut::<DataRequester>(follower)
            .unwrap()
            .status = DataRequesterStatus::Success;
        app.world_mut().entity_mut(leader).insert(Deleted);
        app.update();
        assert!(take_requested(&mut app).is_empty());
    }

    #[test]
    fn a_deleted_follower_is_never_promoted() {
        let mut app = make_app();
        let url = "https://example.com/c.png";
        let leader = spawn_consumer(&mut app, url);
        app.update();
        assert_eq!(take_requested(&mut app), vec![leader]);
        let a = spawn_consumer(&mut app, url);
        let b = spawn_consumer(&mut app, url);
        app.update();

        // The leader and one follower go in the same frame; the survivor
        // leads, whichever of the two the registry would have listed first.
        app.world_mut().entity_mut(leader).insert(Deleted);
        app.world_mut().entity_mut(a).insert(Deleted);
        app.update();
        assert_eq!(take_requested(&mut app), vec![b]);
    }

    #[test]
    fn a_follower_loaded_in_the_promotion_frame_is_not_redispatched() {
        let mut app = make_app();
        let url = "https://example.com/d.png";
        let leader = spawn_consumer(&mut app, url);
        let follower = spawn_consumer(&mut app, url);
        app.update();
        assert_eq!(take_requested(&mut app), vec![leader]);

        // The leader's fetch reported before its removal reached the frontend.
        let handle = app.world().get::<DataRequester>(follower).unwrap().handle;
        app.world_mut().entity_mut(leader).insert(Deleted);
        app.world_mut().write_message(BufferStoreLoadedEvent {
            id: leader,
            ty: navara_buffer_store::BufferType::U8,
            handle,
        });
        app.update();
        assert!(take_requested(&mut app).is_empty());
        assert!(
            app.world()
                .get::<DataRequester>(follower)
                .unwrap()
                .is_succeeded()
        );
    }

    #[test]
    fn a_follower_failed_in_the_promotion_frame_is_not_redispatched() {
        let mut app = make_app();
        let url = "https://example.com/f.png";
        let leader = spawn_consumer(&mut app, url);
        let follower = spawn_consumer(&mut app, url);
        app.update();
        assert_eq!(take_requested(&mut app), vec![leader]);

        // The leader's fetch failed before its removal reached the frontend;
        // the leader is unregistered before the report lands.
        let handle = app.world().get::<DataRequester>(follower).unwrap().handle;
        app.world_mut().entity_mut(leader).insert(Deleted);
        app.world_mut()
            .write_message(BufferStoreFailedEvent { id: leader, handle });
        app.update();
        assert!(take_requested(&mut app).is_empty());
        assert!(
            app.world()
                .get::<DataRequester>(follower)
                .unwrap()
                .is_failed()
        );
    }

    #[test]
    fn a_loaded_fetch_releases_the_leader() {
        let mut app = make_app();
        let url = "https://example.com/e.png";
        let leader = spawn_consumer(&mut app, url);
        app.update();
        assert_eq!(take_requested(&mut app), vec![leader]);

        let handle = app.world().get::<DataRequester>(leader).unwrap().handle;
        app.world_mut().write_message(BufferStoreLoadedEvent {
            id: leader,
            ty: navara_buffer_store::BufferType::U8,
            handle,
        });
        app.update();

        // The buffer is absent (never stored as u8), so a new consumer must
        // dispatch instead of waiting on the settled fetch.
        let next = spawn_consumer(&mut app, url);
        assert!(!app.world().entity(next).contains::<Requested>());
        app.update();
        assert_eq!(take_requested(&mut app), vec![next]);
    }

    fn set_worker_intake_paused(app: &mut App, paused: bool) {
        app.world_mut().insert_resource(WorkerLimits {
            intake_paused: paused,
            ..Default::default()
        });
    }

    /// While worker intake is paused an image fetch is held back (a
    /// non-image one is not), keeps `Requested`, and is emitted on resume.
    #[test]
    fn an_image_fetch_waits_for_worker_intake() {
        let mut app = make_app();
        set_worker_intake_paused(&mut app, true);
        let image = spawn_consumer(&mut app, "https://example.com/dem.png");
        let json = spawn_consumer_of(
            &mut app,
            "https://example.com/tileset.json",
            DataRequesterExtension::Json,
        );
        app.update();
        assert_eq!(take_requested(&mut app), vec![json]);
        assert!(app.world().entity(image).contains::<DeferredDataRequest>());
        assert!(app.world().entity(image).contains::<Requested>());

        app.update();
        assert!(take_requested(&mut app).is_empty());

        set_worker_intake_paused(&mut app, false);
        app.update();
        assert_eq!(take_requested(&mut app), vec![image]);
        assert!(!app.world().entity(image).contains::<DeferredDataRequest>());

        app.update();
        assert!(take_requested(&mut app).is_empty());
    }

    /// A follower promoted while intake is paused is held back like a new
    /// fetch; a deferred leader removed before resuming is never emitted.
    #[test]
    fn a_promoted_image_fetch_waits_for_worker_intake() {
        let mut app = make_app();
        let url = "https://example.com/g.png";
        let leader = spawn_consumer(&mut app, url);
        let follower = spawn_consumer(&mut app, url);
        app.update();
        assert_eq!(take_requested(&mut app), vec![leader]);

        set_worker_intake_paused(&mut app, true);
        app.world_mut().entity_mut(leader).insert(Deleted);
        app.update();
        assert!(take_requested(&mut app).is_empty());
        assert!(
            app.world()
                .entity(follower)
                .contains::<DeferredDataRequest>()
        );

        app.world_mut().entity_mut(follower).insert(Deleted);
        set_worker_intake_paused(&mut app, false);
        app.update();
        assert!(take_requested(&mut app).is_empty());
    }
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use bevy_app::App;
    use bevy_ecs::component::Component;

    use super::*;

    #[derive(Component, PartialEq, Eq, Clone, Copy, Debug)]
    struct TestKey(i32);

    impl PartialOrd for TestKey {
        fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
            Some(self.cmp(other))
        }
    }

    impl Ord for TestKey {
        fn cmp(&self, other: &Self) -> Ordering {
            self.0.cmp(&other.0)
        }
    }

    impl RequestOrderKey for TestKey {}

    fn spawn_requester(app: &mut App, priority: Priority, key: i32) -> bevy_ecs::entity::Entity {
        app.world_mut()
            .spawn((
                DataRequester::default(),
                priority,
                RequestOrder(TestKey(key)),
            ))
            .id()
    }

    /// A requester its pipeline holds back is not sent, whichever sender
    /// runs, until the pipeline releases it.
    #[test]
    fn senders_send_a_waiting_requester_once_released() {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.init_resource::<DataManager>();
        app.add_systems(
            bevy_app::Update,
            (
                send_data_request_events_with_priority_and_sort::<TestKey>,
                send_data_request_events_with_priority,
            )
                .chain(),
        );

        let sent = spawn_requester(&mut app, Priority::High, 1);
        let held = spawn_requester(&mut app, Priority::High, 2);
        app.world_mut().entity_mut(held).insert(Waiting);
        app.update();

        let order = app.world().resource::<EventStore>().data_requested.clone();
        assert_eq!(order, vec![sent]);
        assert!(app.world().get::<Requested>(held).is_none());

        app.world_mut()
            .entity_mut(held)
            .remove::<Waiting>()
            .insert(Resumed);
        app.update();
        let order = app.world().resource::<EventStore>().data_requested.clone();
        assert_eq!(order, vec![sent, held]);
        assert!(app.world().get::<Requested>(held).is_some());
    }

    #[test]
    fn priority_and_sort_enqueues_in_ascending_order() {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.init_resource::<DataManager>();
        app.add_systems(
            bevy_app::Update,
            send_data_request_events_with_priority_and_sort::<TestKey>,
        );

        // Spawn in deliberately scrambled key order; the sender must reorder them.
        let e1 = spawn_requester(&mut app, Priority::High, 30);
        let e2 = spawn_requester(&mut app, Priority::High, 10);
        let e3 = spawn_requester(&mut app, Priority::High, 20);

        app.update();

        let order = app.world().resource::<EventStore>().data_requested.clone();
        assert_eq!(order, vec![e2, e3, e1]);

        // All three should now carry Requested so a second tick is a no-op.
        for e in [e1, e2, e3] {
            assert!(app.world().get::<Requested>(e).is_some());
        }
    }

    #[test]
    fn priority_and_sort_sorts_priority_before_key() {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.init_resource::<DataManager>();
        app.add_systems(
            bevy_app::Update,
            send_data_request_events_with_priority_and_sort::<TestKey>,
        );

        // Lower-priority entity has a smaller key; priority must still win.
        let high = spawn_requester(&mut app, Priority::High, 100);
        let low = spawn_requester(&mut app, Priority::Low, 1);

        app.update();

        let order = app.world().resource::<EventStore>().data_requested.clone();
        assert_eq!(order, vec![high, low]);
    }

    #[test]
    fn default_sender_skips_already_requested_entities() {
        // Mirrors the production wiring: the priority+sort sender runs in
        // DataRequesterSet::PrioritizeRequests and the built-in priority-only
        // sender in DataRequesterSet::SendRequests, with the two sets chained
        // exactly as DataRequesterPlugin configures them. This exercises the
        // cross-set sync point (not an over-constrained single .chain()), so a
        // missing flush of the Requested insert would surface here as a
        // duplicate enqueue.
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.init_resource::<DataManager>();
        app.configure_sets(
            PostUpdate,
            (
                DataRequesterSet::PrioritizeRequests,
                DataRequesterSet::SendRequests,
            )
                .chain(),
        );
        app.add_systems(
            PostUpdate,
            send_data_request_events_with_priority_and_sort::<TestKey>
                .in_set(DataRequesterSet::PrioritizeRequests),
        );
        app.add_systems(
            PostUpdate,
            send_data_request_events_with_priority.in_set(DataRequesterSet::SendRequests),
        );

        let with_key = spawn_requester(&mut app, Priority::High, 5);
        // An entity that has Priority but no RequestOrder<TestKey> — should
        // be picked up by the default sender.
        let without_key = app
            .world_mut()
            .spawn((DataRequester::default(), Priority::High))
            .id();

        app.update();

        let order = app.world().resource::<EventStore>().data_requested.clone();
        // The keyed entity went first via the specialized sender; the keyless
        // one followed via the default sender — and the keyed one was not
        // re-pushed (no duplicates).
        assert_eq!(order.len(), 2);
        assert_eq!(order[0], with_key);
        assert_eq!(order[1], without_key);
    }
}
