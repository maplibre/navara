//! [`PmtilesSource`]: a [`VectorTileSource`] whose tiles come from a single
//! PMTiles v3 archive fetched over HTTP byte ranges.
//!
//! The container parsing/resolution lives in the `pmtiles` crate (via
//! `navara_parser::pmtiles`); this type is the ECS binding that drives it and
//! issues byte-range requests. Decoding the resolved tile payload is delegated
//! to an injected [`TilePayloadDecoder`], so this crate stays free of any
//! payload-format (e.g. MVT) dependency.
//!
//! ## Request kinds
//! - **Meta requests** (header + leaf directories): tagged [`PmtilesMetaMarker`]
//!   with no [`VectorTileDataRequesterMarker`], so they're dispatched to JS by
//!   the data-requester sender but ignored by the vector-tile request
//!   backpressure. There are very few of them per archive.
//! - **Tile requests**: tagged [`VectorTileDataRequesterMarker`] exactly like
//!   the `{z}/{x}/{y}` MVT source, so they're tracked, throttled, and cleaned up
//!   identically.
//!
//! Both kinds use unmanaged [`DataRequester::from_store`] requests, so multiple
//! ranges against the one archive URL never collapse via `DataManager` dedup.

use std::any::Any;
use std::collections::{HashMap, HashSet};

use bevy_ecs::{
    component::Component,
    entity::Entity,
    query::{Added, With, Without},
    system::{Commands, Query},
};
use navara_buffer_store::{BufferStore, Handle};
use navara_component::{Deleted, Ignored, OrderByDistance, Priority, Requested};
use navara_data_requester::{
    DataRequester, DataRequesterExtension, DataRequesterStatus, RequestOrder, RequestOrderKey,
};
use navara_feature_component::batch::BatchTable;
use navara_parser::pmtiles::{Archive, ByteRange, Compression, Resolution};
use navara_tile_component::{TileHandle, VectorTile};
use navara_vector_tile::{
    ReadyState, TileCacheManager, TileSource, VectorTileSource,
    data_requester::{VectorTileDataRequesterMarker, VectorTileDataRequesterQuery},
};

use crate::decoder::TilePayloadDecoder;

/// Marks a [`DataRequester`] that fetches PMTiles container bytes (the header
/// or a leaf directory) rather than a tile payload. Kept distinct from
/// [`VectorTileDataRequesterMarker`] so these requests bypass tile backpressure.
#[derive(Component)]
pub struct PmtilesMetaMarker;

/// Secondary request-queue sort key for PMTiles container (header/leaf) fetches:
/// **highest SSE first, then nearest**. Because directory fetches gate their
/// tiles, ordering them by the demanding-ness of the viewport region they serve
/// makes the view center resolve first — which matters under HTTP/1.1's small
/// concurrent-connection limit, where dispatch order decides what loads first.
///
/// Wraps [`OrderByDistance`] so the ordering policy is shared with tile requests
/// rather than reimplemented; the derived [`Ord`] delegates to the inner value.
#[derive(Component, PartialEq, Eq, PartialOrd, Ord, Debug, Clone)]
pub struct PmtilesMetaOrder(pub OrderByDistance);

impl PmtilesMetaOrder {
    /// Order that sorts ahead of any tile-triggered fetch — used for the
    /// bootstrap (header/root dir), which gates the entire archive.
    const FIRST: Self = Self(OrderByDistance {
        sse: f64::MAX,
        distance: 0.0,
    });
}

impl RequestOrderKey for PmtilesMetaOrder {}

/// A vector-tile source backed by a PMTiles archive.
pub struct PmtilesSource {
    /// URL of the `.pmtiles` archive (no `{z}/{x}/{y}` template).
    pub url: String,
    /// Decodes resolved tile payloads into geometry (e.g. MVT, supplied by `navara_mvt`).
    decoder: Box<dyn TilePayloadDecoder>,
    /// Container parsing/resolution state machine.
    archive: Archive,
    /// In-flight header/root-directory request, if any: `(entity, buffer handle)`.
    bootstrap_req: Option<(Entity, Handle)>,
    /// In-flight leaf-directory requests, keyed by leaf offset.
    leaf_reqs: HashMap<u64, (Entity, Handle)>,
}

impl PmtilesSource {
    /// Create a source for `url` whose tile payloads are decoded by `decoder`.
    #[must_use]
    pub fn new(url: String, decoder: Box<dyn TilePayloadDecoder>) -> Self {
        Self {
            url,
            decoder,
            archive: Archive::new(),
            bootstrap_req: None,
            leaf_reqs: HashMap::new(),
        }
    }

    /// Mutable access to the injected payload decoder, so the owning format crate
    /// can reach its decoder-specific state (e.g. per-layer styling) by
    /// downcasting [`TilePayloadDecoder::as_any_mut`].
    pub fn decoder_mut(&mut self) -> &mut dyn TilePayloadDecoder {
        &mut *self.decoder
    }

    /// Spawn an unmanaged meta request for `range`, ordered by `order` so the
    /// view center's directory chain resolves first, and return its tracking pair.
    fn spawn_meta(
        &self,
        commands: &mut Commands,
        buf: &mut BufferStore,
        range: ByteRange,
        order: PmtilesMetaOrder,
    ) -> (Entity, Handle) {
        let req = DataRequester::from_store(self.url.clone(), buf, DataRequesterExtension::Mvt)
            .with_byte_range(range.offset, range.length);
        let handle = req.handle;
        let entity = commands
            .spawn((PmtilesMetaMarker, req, Priority::High, RequestOrder(order)))
            .id();
        (entity, handle)
    }

    /// Advance the archive: feed any completed header/leaf bytes, then issue the
    /// next bootstrap request if one is due. Cheap and idempotent, so it's safe
    /// to call once per `prepare_tile` (which may run for many tiles per frame).
    fn drive(&mut self, commands: &mut Commands, buf: &mut BufferStore) {
        // Bootstrap: consume completed bytes...
        if let Some((entity, handle)) = self.bootstrap_req
            && let Some(bytes) = buf.remove_u8(&handle)
        {
            // A parse error transitions the archive to failed; surfaced via `ready_state`.
            let _ = self.archive.on_bootstrap_bytes(&bytes);
            commands.entity(entity).despawn();
            self.bootstrap_req = None;
        }
        // ...then issue the next bootstrap request (header, or a fallback root dir).
        if self.bootstrap_req.is_none()
            && !self.archive.is_ready()
            && !self.archive.is_failed()
            && let Some(range) = self.archive.take_bootstrap_request()
        {
            // The bootstrap gates everything, so it sorts ahead of all leaves.
            self.bootstrap_req =
                Some(self.spawn_meta(commands, buf, range, PmtilesMetaOrder::FIRST));
        }

        // Leaves: feed any whose bytes have landed.
        let ready: Vec<u64> = self
            .leaf_reqs
            .iter()
            .filter(|(_, (_, handle))| buf.contains(handle))
            .map(|(offset, _)| *offset)
            .collect();
        for offset in ready {
            let (entity, handle) = self
                .leaf_reqs
                .remove(&offset)
                .expect("offset just collected");
            if let Some(bytes) = buf.remove_u8(&handle) {
                // A malformed leaf will never parse on a refetch either; mark
                // it failed so its tiles resolve to `Absent` instead of
                // `resolve` returning `NeedLeaf` (and re-requesting) forever.
                if self.archive.on_leaf_bytes(offset, &bytes).is_err() {
                    self.archive.mark_leaf_failed(offset);
                }
            }
            commands.entity(entity).despawn();
        }
    }

    /// Resolve a tile's data-requester status into a [`ReadyState`] (mirrors the
    /// `{z}/{x}/{y}` MVT source).
    fn tile_ready_state(
        &self,
        tile: &VectorTile,
        data_requesters: &VectorTileDataRequesterQuery,
    ) -> ReadyState {
        let data_requester = tile
            .data_requester_entity_id
            .and_then(|e| data_requesters.get(e).ok());
        match data_requester {
            Some((_, dr)) if tile.is_ready(&dr.status) => ReadyState::Success,
            Some((_, dr)) if matches!(dr.status, DataRequesterStatus::Fail) => ReadyState::Failed,
            _ => ReadyState::Pending,
        }
    }

    /// Detect meta requests (header / leaf directory) that failed at the
    /// network layer and reflect that on the archive: a failed bootstrap fails
    /// the whole archive; a failed leaf is simply dropped from `leaf_reqs` so
    /// `resolve` re-emits `NeedLeaf` and the fetch is retried.
    ///
    /// A network-layer failure here is transient — it includes an *aborted*
    /// request (a viewport change, or the `MAX_PENDING_META` throttle deleting
    /// an excess in-flight leaf), which the JS fetch reports the same as a real
    /// error. Marking such a leaf permanently failed would resolve every tile
    /// behind it to `Absent` forever (a leaf can be evicted and re-fetched
    /// under the byte cap), so a single dropped request would permanently
    /// vanish a region. Only a malformed *parsed* leaf (see `drive`) is
    /// recorded as permanently failed.
    ///
    /// This needs the `DataRequester` status — failures never write a buffer,
    /// so `drive`'s `buf` polling cannot observe them. Called from the
    /// [`handle_pmtiles_meta_failures`] system, which has the status query.
    fn handle_meta_failures(
        &mut self,
        commands: &mut Commands,
        requesters: &Query<&DataRequester, With<PmtilesMetaMarker>>,
    ) {
        if let Some((entity, _)) = self.bootstrap_req
            && requesters.get(entity).is_ok_and(DataRequester::is_failed)
        {
            self.archive.mark_failed();
            commands.entity(entity).despawn();
            self.bootstrap_req = None;
        }

        let failed: Vec<(u64, Entity)> = self
            .leaf_reqs
            .iter()
            .filter(|(_, (entity, _))| requesters.get(*entity).is_ok_and(DataRequester::is_failed))
            .map(|(offset, (entity, _))| (*offset, *entity))
            .collect();
        for (offset, entity) in failed {
            // Transient: drop the in-flight request so `resolve` re-emits
            // `NeedLeaf` and the leaf is retried. Do NOT `mark_leaf_failed` —
            // that is reserved for malformed parsed bytes (see `drive`).
            self.leaf_reqs.remove(&offset);
            commands.entity(entity).despawn();
        }
    }
}

/// Maximum number of PMTiles container (header/leaf) fetches allowed in flight
/// at once. Mirrors the tile-request cap in
/// [`filter_requestable_data_requester`](navara_vector_tile::data_requester::system).
const MAX_PENDING_META: usize = 50;

/// System: cap the number of in-flight PMTiles container (header/leaf) fetches,
/// the meta-request analogue of
/// [`filter_requestable_data_requester`](navara_vector_tile::data_requester::system)
/// (which only governs tile requests). Without it, a zoomed-out viewport over a
/// global-scale archive could spawn a leaf-directory request for every distinct
/// leaf at once and saturate the request pipeline, blocking the app.
///
/// Excess requests — lowest [`PmtilesMetaOrder`] (lowest SSE / farthest) first —
/// are marked `(Deleted, Ignored)` so the sender skips them and
/// `remove_removed_data_requesters` despawns them. Each owning [`PmtilesSource`]
/// is told to forget the dropped leaves, so the next `prepare_tile` re-issues
/// them — with a fresh, current priority — once earlier fetches free up slots.
///
/// The bootstrap request lives in `bootstrap_req` (not `leaf_reqs`, the only map this
/// system clears). It is ordered ahead of leaf requests via `PmtilesMetaOrder::FIRST`,
/// but it can still be dropped if the global meta-request cap is saturated; in that
/// case we reset and retry bootstrapping in a future frame.
#[allow(clippy::type_complexity)]
pub(crate) fn filter_requestable_pmtiles_meta(
    mut commands: Commands,
    mut sources: Query<&mut TileSource>,
    added: Query<
        (Entity, &Priority, &RequestOrder<PmtilesMetaOrder>),
        (Added<PmtilesMetaMarker>, Without<Deleted>),
    >,
    pending: Query<
        Entity,
        (
            With<PmtilesMetaMarker>,
            With<DataRequester>,
            With<Requested>,
            Without<Deleted>,
        ),
    >,
) {
    let free_slots = MAX_PENDING_META.saturating_sub(pending.iter().count());

    // Keep the `free_slots` most-demanding new requests (sorted ahead); drop the rest.
    let dropped: HashSet<Entity> = added
        .iter()
        .sort::<(&Priority, &RequestOrder<PmtilesMetaOrder>)>()
        .skip(free_slots)
        .map(|(e, _, _)| e)
        .collect();
    if dropped.is_empty() {
        return;
    }

    // Forget dropped requests so sources can retry them later; otherwise they would
    // treat them as forever in-flight and deadlock.
    for mut tile_source in &mut sources {
        if let Some(source) = tile_source.downcast_mut::<PmtilesSource>() {
            // Leaves can be retried by clearing their in-flight markers.
            source.leaf_reqs.retain(|_, (e, _)| !dropped.contains(e));
            // If the bootstrap request was dropped, clear it and reset the archive
            // so a future frame can re-issue the bootstrap range.
            if let Some((e, _)) = source.bootstrap_req
                && dropped.contains(&e)
            {
                source.bootstrap_req = None;
                source.archive = Archive::new();
            }
        }
    }
    for e in dropped {
        commands.entity(e).try_insert((Deleted, Ignored));
    }
}

/// System: surface network failures of PMTiles container (header/leaf) fetches
/// onto their archives. Without it, a failed bootstrap would leave the layer
/// stuck `Pending` (blank) forever, since such failures produce no buffer bytes.
pub(crate) fn handle_pmtiles_meta_failures(
    mut commands: Commands,
    mut sources: Query<&mut TileSource>,
    requesters: Query<&DataRequester, With<PmtilesMetaMarker>>,
) {
    for mut tile_source in &mut sources {
        if let Some(source) = tile_source.downcast_mut::<PmtilesSource>() {
            source.handle_meta_failures(&mut commands, &requesters);
        }
    }
}

impl VectorTileSource for PmtilesSource {
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    fn prepare_tile(
        &mut self,
        commands: &mut Commands,
        tile: &mut VectorTile,
        handle: TileHandle,
        tc: &mut TileCacheManager,
        buf: &mut BufferStore,
        data_requesters: &VectorTileDataRequesterQuery,
        priority: Priority,
    ) -> bool {
        self.drive(commands, buf);

        if !self.archive.is_ready() {
            // Keep the update loop alive while bootstrapping (a failed archive
            // stops here, leaving tiles to resolve as `Failed` in ready_state).
            if !self.archive.is_failed() {
                tc.needs_update = true;
            }
            return false;
        }

        match self.archive.resolve(
            tile.coords.z as u8,
            tile.coords.x as u32,
            tile.coords.y as u32,
        ) {
            Resolution::Tile { request } => {
                // Don't duplicate a tile request that's already in flight.
                if matches!(tile.data_requester_entity_id, Some(e) if data_requesters.contains(e)) {
                    return false;
                }
                let entity = commands
                    .spawn((
                        VectorTileDataRequesterMarker(handle),
                        DataRequester::from_store(
                            self.url.clone(),
                            buf,
                            DataRequesterExtension::Mvt,
                        )
                        .with_byte_range(request.offset, request.length),
                        OrderByDistance {
                            sse: tile.sse,
                            distance: tile.distance_from_camera,
                        },
                        priority,
                    ))
                    .id();
                tile.data_requester_entity_id = Some(entity);
                tc.requested_tile_caches.insert(handle, entity);
                true
            }
            Resolution::NeedLeaf {
                leaf_offset,
                request,
            } => {
                if !self.leaf_reqs.contains_key(&leaf_offset) {
                    // Order this leaf by the tile that needs it, so leaves for
                    // the view center are fetched before peripheral ones.
                    let order = PmtilesMetaOrder(OrderByDistance {
                        sse: tile.sse,
                        distance: tile.distance_from_camera,
                    });
                    let req = self.spawn_meta(commands, buf, request, order);
                    self.leaf_reqs.insert(leaf_offset, req);
                }
                tc.needs_update = true; // keep polling until the leaf lands
                false
            }
            Resolution::Absent => false,
        }
    }

    fn construct_geometry(
        &mut self,
        commands: &mut Commands,
        batch_table: &mut BatchTable,
        buf: &mut BufferStore,
        tile: &VectorTile,
        tile_handle: TileHandle,
        rendered_tile: Entity,
        order: &OrderByDistance,
        data_requester: Option<&DataRequester>,
    ) -> Option<Vec<Entity>> {
        let data_req = data_requester?;

        // Hand the raw (possibly gzip-compressed) tile bytes and the container's
        // compression to the decoder. The decoder owns decompression so it can
        // offload it (with parsing) to a worker instead of blocking here.
        let compression = self
            .archive
            .header()
            .map_or(Compression::None, |h| h.tile_compression);

        self.decoder.decode(
            commands,
            batch_table,
            buf,
            data_req.handle,
            compression,
            tile,
            tile_handle,
            rendered_tile,
            order,
        )
    }

    fn ready_state(
        &self,
        tile: &VectorTile,
        data_requesters: &VectorTileDataRequesterQuery,
    ) -> ReadyState {
        if self.archive.is_failed() {
            return ReadyState::Failed;
        }
        if !self.archive.is_ready() {
            return ReadyState::Pending;
        }
        match self.archive.resolve(
            tile.coords.z as u8,
            tile.coords.x as u32,
            tile.coords.y as u32,
        ) {
            // No tile here: report failed so traversal stops waiting on it.
            Resolution::Absent => ReadyState::Failed,
            // A leaf still has to be fetched before this tile can resolve.
            Resolution::NeedLeaf { .. } => ReadyState::Pending,
            Resolution::Tile { .. } => self.tile_ready_state(tile, data_requesters),
        }
    }
}
