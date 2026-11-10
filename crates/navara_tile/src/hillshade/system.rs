use bevy_ecs::{
    component::Component,
    entity::Entity,
    query::{Added, Changed, With, Without},
    system::{Commands, Query, Res, ResMut},
};
use navara_buffer_store::BufferStore;
use navara_component::{Deleted, Ignored, OrderByDistance, Priority, Requested};
use navara_data_requester::DataRequester;
use navara_event_store::EventStore;
use navara_quadtree::{decode_quadleaf_handle, encode_quadleaf_handle};
use navara_tile_component::{
    HillshadeBackfillEventData, HillshadeBackfillEvents, HillshadeCancelRequested, HillshadeEdges,
    HillshadeEdgesExtracted,
};
use navara_tile_component::{TerrainTileQuadtree, TileTextureFragmentMarker};

/// Marker component to identify hillshade DEM texture requests
/// This distinguishes hillshade DataRequesters from other types
#[derive(Debug, Clone, Copy, Component)]
pub struct HillshadeTextureMarker;

/// The DEM decoder of the hillshade layer's source, captured when the
/// hillshade DataRequester is spawned. The normal map must be decoded with it,
/// not with the terrain's decoder: the hillshade source can differ from the
/// terrain source, or there may be no DEM terrain at all.
#[derive(Debug, Clone, Copy, Component)]
pub struct HillshadeElevationDecoder(pub navara_core::ElevationDecoder);

/// Marker component indicating that HillshadeBackfillEvents have been extracted
/// Used to delay cleanup until after read_events() has accessed the data
#[derive(Debug, Clone, Copy, Component)]
pub(crate) struct HillshadeEventsExtracted;

/// Query type for cleanup_hillshade_edges system
type CleanupHillshadeEdgesQuery<'w, 's> =
    Query<'w, 's, (Entity, &'static HillshadeEdges), (With<Deleted>, With<HillshadeTextureMarker>)>;

/// Extracted edge data from a hillshade DEM texture
/// Contains all 4 edges for sharing with neighbors
struct ExtractedEdges {
    left: Vec<u8>,
    right: Vec<u8>,
    top: Vec<u8>,
    bottom: Vec<u8>,
}

/// Edge direction for hillshade texture updates
#[derive(Debug, Clone, Copy)]
enum EdgeDirection {
    Left = 0,
    Right = 1,
    Top = 2,
    Bottom = 3,
}

/// System that limits concurrent hillshade DataRequester entities
/// Prevents too many simultaneous requests by pruning lowest-priority tiles
/// Works similarly to filter_requestable_texture_fragment but for hillshade DataRequesters
///
/// Each requester actually dispatched gets a dispatch-time `ReservedCost`: the
/// DEM payload and the extracted boundary edge strips only become gate-visible
/// (BufferStore `cpu_bytes`) AFTER the fetch lands, so the in-flight window has
/// the same overshoot hole as the other pipelines. The estimate comes from the
/// pipeline-wide hillshade estimator pool (payloads are a per-source constant,
/// so per-layer pools would buy nothing), seeded by
/// `CostHints::hillshade_reserve_seed` (raster tile bytes + the 1/64 edge-strip
/// overhead) while cold.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn filter_requestable_hillshade_data_requester(
    mut commands: Commands,
    mut qt: ResMut<TerrainTileQuadtree>,
    hillshade_requesters: Query<
        (
            Entity,
            &TileTextureFragmentMarker,
            &DataRequester,
            &OrderByDistance,
            &Priority,
        ),
        (
            Added<TileTextureFragmentMarker>,
            With<HillshadeTextureMarker>,
            Without<Deleted>,
        ),
    >,
    requested_hillshades: Query<
        &DataRequester,
        (
            With<TileTextureFragmentMarker>,
            With<HillshadeTextureMarker>,
            With<Requested>,
            Without<Deleted>,
        ),
    >,
    limits: Res<navara_data_requester::RequestLimits>,
    pressure: Res<navara_memory::SsePressure>,
    ledger: Res<navara_memory::MemoryLedger>,
) {
    // Count only Pending DataRequesters with Requested marker.
    // Success+Requested entities exist (shared-handle consumers with already-loaded data)
    // and should not count toward the limit.
    let pendings = requested_hillshades
        .iter()
        .filter(|dr| dr.status == navara_data_requester::DataRequesterStatus::Pending)
        .count();
    // Load gate: when the memory budget is exhausted, start ZERO new fetches
    // and settle on the already-loaded tiles instead of evicting → refetching
    // in an endless loop. In-flight requests proceed; forcing `num_skip == 0`
    // rejects every newly-Added requester this frame so none is dispatched.
    let num_skip = if pressure.load_gate_closed {
        0
    } else {
        (limits.max_pendings as i32 - pendings as i32).max(0)
    };

    // Limit the number of hillshade requests in this frame.
    // Skip DataRequesters with Success status - they already have
    // their data (loaded by previous consumers) and should not be subject to the
    // max_pendings limit. Rejecting them would cause create-delete loops.
    let admissible: Vec<_> = hillshade_requesters
        .iter()
        .sort::<(&Priority, &OrderByDistance)>()
        .filter(|(_, _, data_req, _, _)| {
            data_req.status != navara_data_requester::DataRequesterStatus::Success
        })
        .collect();

    // Reserve the adaptive estimate for the requesters actually dispatched
    // this frame (the admitted prefix — the rejected tail below gets none).
    // The amount is resolved by the `ReservedCost` on_insert hook; released on
    // resolve or despawn; see `ReservedCost`.
    if ledger.enabled() {
        for (e, _, _, _, _) in admissible.iter().take(num_skip as usize) {
            commands
                .entity(*e)
                .try_insert(navara_memory::ReservedCost::for_key(
                    navara_memory::ReserveKey::Hillshade,
                ));
        }
    }

    for (e, marker, _, _, _) in admissible.into_iter().skip(num_skip as usize) {
        let handle = marker.0;
        let tile = qt.qt.get_mut(handle);
        if let Some(tile) = tile {
            commands.entity(e).insert((Deleted, Ignored));

            // Clear the rejected slot to None so the next request_texture_fragment
            // pass can re-spawn an entity for the same layer index
            if let Some(hillshade_ids) = tile.hillshade_entity_ids.as_mut()
                && let Some(slot) = hillshade_ids
                    .iter_mut()
                    .find(|id| matches!(id, Some(id) if *id == e))
            {
                *slot = None;
            }
        }
    }
}

/// System that runs after DataRequester loads hillshade DEM data
/// Sends edge data to JS for texture edge updates
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn backfill_hillshade_on_loaded(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    qt: Res<TerrainTileQuadtree>,
    mut events: ResMut<EventStore>,
    query: Query<
        (
            Entity,
            &DataRequester,
            &TileTextureFragmentMarker,
            Option<&HillshadeElevationDecoder>,
        ),
        (
            Changed<DataRequester>,
            With<HillshadeTextureMarker>,
            Without<Deleted>,
            Without<Ignored>,
        ),
    >,
    edges_query: Query<&HillshadeEdges>,
    extracted_query: Query<(), With<HillshadeEdgesExtracted>>,
    data_requesters: Query<
        &DataRequester,
        (
            With<HillshadeTextureMarker>,
            Without<Deleted>,
            Without<Ignored>,
        ),
    >,
    mut estimates: ResMut<navara_memory::ReserveEstimates>,
) {
    // Collect all successfully loaded hillshade entities in this frame for deduplication
    let newly_loaded_entities: std::collections::HashSet<Entity> = query
        .iter()
        .filter(|(_, data_req, _, _)| data_req.is_succeeded())
        .map(|(entity, _, _, _)| entity)
        .collect();

    for (entity, data_req, marker, decoder) in query.iter() {
        // Only process successfully loaded hillshade DataRequesters
        if !data_req.is_succeeded() {
            continue;
        }

        let tile_handle = marker.0;
        let (x, y, z): (usize, usize, usize) = decode_quadleaf_handle(tile_handle);
        let mut event_data_list = Vec::new();

        // Extract edges on first load (sends original data to JS and extracts edges)
        let edges_extracted = extracted_query.contains(entity);
        let extracted_edges = if !edges_extracted {
            event_data_list.push(HillshadeBackfillEventData {
                tile_handle,
                edge_data_handle: -1,
                original_handle: Some(data_req.handle),
                target_entity: None,
                edge_direction: 255,
                elevation_decoder: decoder.map(|d| d.0),
            });

            extract_edges_on_first_load(&buf, data_req)
        } else {
            None
        };

        // First load only: feed the hillshade reservation estimator with the
        // tile's ACTUAL landed footprint — the DEM payload plus the four edge
        // strips about to be stored in `BufferStore` — i.e. what the
        // dispatch-time `ReservedCost` was protecting until now. Failed
        // fetches never reach here (`is_succeeded` gate above); a refetched
        // tile simply records again.
        if let Some(edges) = &extracted_edges {
            let payload_bytes = buf
                .get_u8(&data_req.handle)
                .map(|b| b.len() as u64)
                .unwrap_or(0);
            let edge_bytes =
                (edges.left.len() + edges.right.len() + edges.top.len() + edges.bottom.len())
                    as u64;
            estimates.record(
                navara_memory::ReserveKey::Hillshade,
                payload_bytes + edge_bytes,
            );
        }

        // Collect edge exchanges with all loaded neighbors
        let edges_to_store = collect_neighbor_edge_exchanges(
            entity,
            tile_handle,
            x,
            y,
            z,
            &extracted_edges,
            &edges_query,
            &qt,
            &data_requesters,
            &buf,
            &newly_loaded_entities,
        );

        // Store all collected edges in BufferStore and create events
        for (edge_bytes, target_handle, target_entity, edge_dir) in edges_to_store {
            if edge_bytes.is_empty() {
                continue;
            }
            let edge_handle = buf.new_u8(edge_bytes);
            event_data_list.push(HillshadeBackfillEventData {
                tile_handle: target_handle,
                edge_data_handle: edge_handle,
                original_handle: None,
                target_entity: Some(target_entity),
                edge_direction: edge_dir,
                elevation_decoder: None,
            });
        }

        // Store extracted edges (original data will be cleaned by JS side)
        if let Some(edges) = extracted_edges {
            store_extracted_edges(entity, edges, &mut commands, &mut buf);
        }

        // Add all events to entity and push to EventStore
        commands.entity(entity).insert(HillshadeBackfillEvents {
            events: event_data_list,
        });
        events.hillshade_backfilled.push(entity);
    }
}

/// System that emits hillshade_canceled events for hillshade entities whose
/// owning RasterTile was just destroyed.
///
/// Scoped to the `HillshadeCancelRequested` marker (inserted by
/// `RasterTile::destroy`) so it fires only on the tile-destruction path, not
/// on every entity that happens to pick up `Deleted + HillshadeTextureMarker`.
/// The marker is a one-shot — consumed on emit — so no separate "already
/// emitted" guard is needed. Texture/render-target teardown is left to
/// `texture_fragment_removed`; this event only cancels in-flight backfill data.
///
/// Runs after `backfill_hillshade_on_loaded` in the same frame, so it also
/// drops this frame's backfills aimed at a cancelled entity (the target of an
/// edge update, the source otherwise) and frees their edge buffers: the
/// frontend never sees them.
pub fn emit_hillshade_canceled(
    mut commands: Commands,
    mut events: ResMut<EventStore>,
    mut buf: ResMut<BufferStore>,
    query: Query<Entity, With<HillshadeCancelRequested>>,
    mut backfills: Query<&mut HillshadeBackfillEvents>,
) {
    if query.is_empty() {
        return;
    }
    for &source in &events.hillshade_backfilled {
        let Ok(mut backfill) = backfills.get_mut(source) else {
            continue;
        };
        backfill.events.retain(|data| {
            let stale = query.contains(data.target_entity.unwrap_or(source));
            if stale && data.edge_data_handle >= 0 {
                buf.remove(&data.edge_data_handle);
            }
            !stale
        });
    }
    for entity in query.iter() {
        events.hillshade_canceled.push(entity);
        commands.entity(entity).remove::<HillshadeCancelRequested>();
    }
}

/// System that cleans up hillshade edge data when entities are deleted
/// Removes the 4 edge buffers from BufferStore to prevent memory leaks
pub fn cleanup_hillshade_edges(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    removed: CleanupHillshadeEdgesQuery,
) {
    for (entity, edges) in removed.iter() {
        // Remove all 4 edge buffers
        buf.remove(&edges.left);
        buf.remove(&edges.right);
        buf.remove(&edges.top);
        buf.remove(&edges.bottom);
        // Ensure this cleanup runs only once per entity by removing HillshadeEdges
        commands.entity(entity).remove::<HillshadeEdges>();
    }
}

/// System that cleans up HillshadeBackfillEvents after events are dispatched
/// Prevents memory leaks and stale event re-emission
/// Uses a two-phase approach: mark in first frame, cleanup in second frame
pub(crate) fn cleanup_hillshade_backfill_events(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    query: Query<(
        Entity,
        &HillshadeBackfillEvents,
        Option<&HillshadeEventsExtracted>,
    )>,
) {
    for (entity, events, extracted_marker) in query.iter() {
        if extracted_marker.is_some() {
            // Frame N+1: Marker exists, safe to cleanup
            // Frame N: backfill_hillshade_on_loaded → insert(HillshadeBackfillEvents)
            // Frame N: read_events() → extracts events
            // Frame N: this system → adds HillshadeEventsExtracted marker
            // Frame N+1: this system → removes both components
            for event in &events.events {
                if event.edge_data_handle >= 0 {
                    buf.remove(&event.edge_data_handle);
                }
            }
            commands.entity(entity).remove::<HillshadeBackfillEvents>();
            commands.entity(entity).remove::<HillshadeEventsExtracted>();
        } else {
            // Frame N: Just added, mark as extracted but don't cleanup yet
            // This allows read_events() to access data before removal
            commands.entity(entity).insert(HillshadeEventsExtracted);
        }
    }
}

/// Extract edges on first load and create initialization event
/// Returns the extracted edges for reuse with neighbors
fn extract_edges_on_first_load(
    buf: &BufferStore,
    data_req: &DataRequester,
) -> Option<ExtractedEdges> {
    buf.get_u8(&data_req.handle)
        .map(|original_bytes| ExtractedEdges {
            left: extract_single_edge(original_bytes, EdgeDirection::Left),
            right: extract_single_edge(original_bytes, EdgeDirection::Right),
            top: extract_single_edge(original_bytes, EdgeDirection::Top),
            bottom: extract_single_edge(original_bytes, EdgeDirection::Bottom),
        })
}

/// Get edge data from tile (either from extracted_edges or stored handles)
fn get_edge_from_tile(
    entity: Entity,
    direction: EdgeDirection,
    extracted_edges: &Option<ExtractedEdges>,
    edges_query: &Query<&HillshadeEdges>,
    buf: &BufferStore,
) -> Option<Vec<u8>> {
    if let Some(edges) = extracted_edges {
        // Use freshly extracted edges (first time loading)
        Some(match direction {
            EdgeDirection::Left => edges.left.clone(),
            EdgeDirection::Right => edges.right.clone(),
            EdgeDirection::Top => edges.top.clone(),
            EdgeDirection::Bottom => edges.bottom.clone(),
        })
    } else if let Ok(edges) = edges_query.get(entity) {
        // Use stored edge handles (subsequent loads)
        let edge_handle = match direction {
            EdgeDirection::Left => edges.left,
            EdgeDirection::Right => edges.right,
            EdgeDirection::Top => edges.top,
            EdgeDirection::Bottom => edges.bottom,
        };
        Some(
            buf.get_u8(&edge_handle)
                .map(|b| b.to_vec())
                .unwrap_or_default(),
        )
    } else {
        None
    }
}

/// Get neighbor tile coordinates with bounds checking
/// Returns None if neighbor is out of valid range
/// X wraps around, Y does not
fn get_neighbor_coords(
    x: usize,
    y: usize,
    z: usize,
    direction: EdgeDirection,
) -> Option<(usize, usize, usize)> {
    let tile_count = 1_usize << z; // 2^z tiles per axis at zoom level z

    match direction {
        EdgeDirection::Left => {
            // West: wrap X coordinate
            let nx = if x == 0 { tile_count - 1 } else { x - 1 };
            Some((nx, y, z))
        }
        EdgeDirection::Right => {
            // East: wrap X coordinate
            let nx = if x + 1 >= tile_count { 0 } else { x + 1 };
            Some((nx, y, z))
        }
        EdgeDirection::Top => {
            // North: Y does not wrap, check bounds
            if y == 0 {
                None // No tile north of y=0
            } else {
                Some((x, y - 1, z))
            }
        }
        EdgeDirection::Bottom => {
            // South: Y does not wrap, check bounds
            if y + 1 >= tile_count {
                None // No tile south of max Y
            } else {
                Some((x, y + 1, z))
            }
        }
    }
}

/// Collect edge exchanges with all loaded neighbors
/// Returns list of (edge_bytes, target_tile_handle, target_entity, edge_direction)
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
fn collect_neighbor_edge_exchanges(
    entity: Entity,
    tile_handle: u64,
    x: usize,
    y: usize,
    z: usize,
    extracted_edges: &Option<ExtractedEdges>,
    edges_query: &Query<&HillshadeEdges>,
    qt: &TerrainTileQuadtree,
    data_requesters: &Query<
        &DataRequester,
        (
            With<HillshadeTextureMarker>,
            Without<Deleted>,
            Without<Ignored>,
        ),
    >,
    buf: &BufferStore,
    newly_loaded_entities: &std::collections::HashSet<Entity>,
) -> Vec<(Vec<u8>, u64, Entity, u8)> {
    // Define neighbor directions (coordinates will be computed with bounds checking)
    let neighbor_directions = [
        EdgeDirection::Left,   // West neighbor
        EdgeDirection::Right,  // East neighbor
        EdgeDirection::Top,    // North neighbor
        EdgeDirection::Bottom, // South neighbor
    ];

    let mut edges_to_store = Vec::new();

    for direction in neighbor_directions {
        // Get neighbor coordinates with bounds checking and wrapping
        let Some((nx, ny, nz)) = get_neighbor_coords(x, y, z, direction) else {
            continue; // Skip out-of-bounds neighbors
        };

        // Map direction from current tile's perspective to neighbor's perspective
        let neighbor_edge_dir = match direction {
            EdgeDirection::Left => EdgeDirection::Right, // West neighbor needs edge on their right
            EdgeDirection::Right => EdgeDirection::Left, // East neighbor needs edge on their left
            EdgeDirection::Top => EdgeDirection::Bottom, // North neighbor needs edge on their bottom
            EdgeDirection::Bottom => EdgeDirection::Top, // South neighbor needs edge on their top
        };
        // Encode neighbor coordinates and check if tile exists
        let Some(neighbor_handle) = encode_quadleaf_handle((nx, ny, nz)) else {
            continue;
        };

        let Some(neighbor_tile) = qt.qt.get(neighbor_handle) else {
            continue; // Neighbor tile not loaded
        };

        // Get the first hillshade entity from neighbor (only support one hillshade per tile for now)
        let Some(neighbor_entity) = neighbor_tile
            .hillshade_entity_ids
            .as_ref()
            .and_then(|ids| ids.iter().find_map(|&id| id))
        else {
            continue; // Neighbor doesn't have hillshade
        };

        let Ok(neighbor_dr) = data_requesters.get(neighbor_entity) else {
            continue; // Neighbor hillshade entity not found in query
        };

        if !neighbor_dr.is_succeeded() {
            continue; // Neighbor not successfully loaded
        }

        // Opposite direction: edge direction on current tile that neighbor needs
        let opposite_dir = match neighbor_edge_dir {
            EdgeDirection::Left => EdgeDirection::Right,
            EdgeDirection::Right => EdgeDirection::Left,
            EdgeDirection::Top => EdgeDirection::Bottom,
            EdgeDirection::Bottom => EdgeDirection::Top,
        };

        // Current tile's edge -> neighbor
        if let Some(edge_for_neighbor) =
            get_edge_from_tile(entity, opposite_dir, extracted_edges, edges_query, buf)
        {
            edges_to_store.push((
                edge_for_neighbor,
                neighbor_handle,
                neighbor_entity,
                neighbor_edge_dir as u8,
            ));
        }

        // Neighbor's edge -> current tile
        // Skip if neighbor is also being processed this frame to avoid duplicate edge updates
        // (neighbor will send its edge to current tile when it processes)
        if !newly_loaded_entities.contains(&neighbor_entity) {
            let edge_for_current = if let Ok(neighbor_edges) = edges_query.get(neighbor_entity) {
                // Neighbor already has extracted edges stored, use them
                let edge_handle = match neighbor_edge_dir {
                    EdgeDirection::Left => neighbor_edges.left,
                    EdgeDirection::Right => neighbor_edges.right,
                    EdgeDirection::Top => neighbor_edges.top,
                    EdgeDirection::Bottom => neighbor_edges.bottom,
                };
                buf.get_u8(&edge_handle)
                    .map(|b| b.to_vec())
                    .unwrap_or_default()
            } else {
                // Neighbor loaded in the same frame: HillshadeEdges component not yet available
                // (inserted via commands, takes effect next frame), but original data still exists
                // (JS-side removeU8 is async). Extract edge from neighbor's original DEM data.
                buf.get_u8(&neighbor_dr.handle)
                    .map(|bytes| extract_single_edge(bytes, neighbor_edge_dir))
                    .unwrap_or_default()
            };

            if !edge_for_current.is_empty() {
                edges_to_store.push((edge_for_current, tile_handle, entity, opposite_dir as u8));
            }
        }
    }

    edges_to_store
}

/// Store extracted edges in BufferStore
/// Original DEM data is deleted by JS side after processing the event
fn store_extracted_edges(
    entity: Entity,
    extracted_edges: ExtractedEdges,
    commands: &mut Commands,
    buf: &mut BufferStore,
) {
    // Store edges in BufferStore (4KB per tile)
    let left_handle = buf.new_u8(extracted_edges.left);
    let right_handle = buf.new_u8(extracted_edges.right);
    let top_handle = buf.new_u8(extracted_edges.top);
    let bottom_handle = buf.new_u8(extracted_edges.bottom);

    // Mark edges as extracted and store edge handles
    commands.entity(entity).insert((
        HillshadeEdgesExtracted,
        HillshadeEdges {
            left: left_handle,
            right: right_handle,
            top: top_handle,
            bottom: bottom_handle,
        },
    ));
}

/// Extract a single edge from original DEM texture based on direction
/// Returns edge data as Vec<u8> (content_size * 4 bytes RGBA)
fn extract_single_edge(src: &[u8], direction: EdgeDirection) -> Vec<u8> {
    if src.len() < 16 {
        // Too small to be a meaningful tile; treat as invalid.
        return Vec::new();
    }
    if !src.len().is_multiple_of(4) {
        // Not a multiple of 4 bytes; cannot be RGBA pixels.
        return Vec::new();
    }
    let pixels = src.len() / 4;
    let src_size = (pixels as f64).sqrt() as usize;
    // Require perfect square and a minimum side length (e.g. 4x4).
    if src_size < 4 || src_size * src_size * 4 != src.len() {
        // Unexpected tile shape/size; skip edge extraction.
        return Vec::new();
    }

    let mut edge = Vec::with_capacity(src_size * 4);

    match direction {
        EdgeDirection::Left => {
            // Left edge (x=0)
            for y in 0..src_size {
                let idx = (y * src_size) * 4;
                if idx + 4 <= src.len() {
                    edge.extend_from_slice(&src[idx..idx + 4]);
                }
            }
        }
        EdgeDirection::Right => {
            // Right edge (x=src_size-1)
            for y in 0..src_size {
                let idx = (y * src_size + (src_size - 1)) * 4;
                if idx + 4 <= src.len() {
                    edge.extend_from_slice(&src[idx..idx + 4]);
                }
            }
        }
        EdgeDirection::Top => {
            // Top edge (y=0)
            for x in 0..src_size {
                let idx = x * 4;
                if idx + 4 <= src.len() {
                    edge.extend_from_slice(&src[idx..idx + 4]);
                }
            }
        }
        EdgeDirection::Bottom => {
            // Bottom edge (y=src_size-1)
            for x in 0..src_size {
                let idx = ((src_size - 1) * src_size + x) * 4;
                if idx + 4 <= src.len() {
                    edge.extend_from_slice(&src[idx..idx + 4]);
                }
            }
        }
    }

    edge
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper to create a test texture with unique values per pixel
    fn create_test_texture(size: usize) -> Vec<u8> {
        let mut buffer = vec![0u8; size * size * 4];
        for y in 0..size {
            for x in 0..size {
                let idx = (y * size + x) * 4;
                buffer[idx] = x as u8; // R
                buffer[idx + 1] = y as u8; // G
                buffer[idx + 2] = (x + y) as u8; // B
                buffer[idx + 3] = 255; // A
            }
        }
        buffer
    }

    #[test]
    fn test_extract_single_edge() {
        let size = 256;
        let texture = create_test_texture(size);

        // Test left edge (x=0)
        let left_edge = extract_single_edge(&texture, EdgeDirection::Left);
        assert_eq!(
            left_edge.len(),
            size * 4,
            "Left edge should be {} bytes",
            size * 4
        );
        for y in 0..size {
            let expected_r = 0; // x=0
            let expected_g = y as u8;
            assert_eq!(left_edge[y * 4], expected_r);
            assert_eq!(left_edge[y * 4 + 1], expected_g);
        }

        // Test right edge (x=255)
        let right_edge = extract_single_edge(&texture, EdgeDirection::Right);
        assert_eq!(
            right_edge.len(),
            size * 4,
            "Right edge should be {} bytes",
            size * 4
        );
        for y in 0..size {
            let expected_r = (size - 1) as u8;
            let expected_g = y as u8;
            assert_eq!(right_edge[y * 4], expected_r);
            assert_eq!(right_edge[y * 4 + 1], expected_g);
        }

        // Test top edge (y=0)
        let top_edge = extract_single_edge(&texture, EdgeDirection::Top);
        assert_eq!(
            top_edge.len(),
            size * 4,
            "Top edge should be {} bytes",
            size * 4
        );
        for x in 0..size {
            let expected_r = x as u8;
            let expected_g = 0; // y=0
            assert_eq!(top_edge[x * 4], expected_r);
            assert_eq!(top_edge[x * 4 + 1], expected_g);
        }

        // Test bottom edge (y=255)
        let bottom_edge = extract_single_edge(&texture, EdgeDirection::Bottom);
        assert_eq!(
            bottom_edge.len(),
            size * 4,
            "Bottom edge should be {} bytes",
            size * 4
        );
        for x in 0..size {
            let expected_r = x as u8;
            let expected_g = (size - 1) as u8;
            assert_eq!(bottom_edge[x * 4], expected_r);
            assert_eq!(bottom_edge[x * 4 + 1], expected_g);
        }
    }

    #[test]
    fn test_extract_single_edge_small_texture() {
        // Test with a smaller texture to verify logic
        let size = 4;
        let texture = create_test_texture(size);

        // Left edge should be [(0,0), (0,1), (0,2), (0,3)]
        let left_edge = extract_single_edge(&texture, EdgeDirection::Left);
        assert_eq!(left_edge.len(), size * 4);
        for y in 0..size {
            assert_eq!(left_edge[y * 4], 0); // x=0
            assert_eq!(left_edge[y * 4 + 1], y as u8); // y
        }

        // Right edge should be [(3,0), (3,1), (3,2), (3,3)]
        let right_edge = extract_single_edge(&texture, EdgeDirection::Right);
        for y in 0..size {
            assert_eq!(right_edge[y * 4], 3); // x=3
            assert_eq!(right_edge[y * 4 + 1], y as u8); // y
        }
    }

    #[test]
    fn cleanup_hillshade_backfill_events_frees_remaining_edge_handles() {
        use bevy_app::App;
        use bevy_app::Update;

        let mut app = App::new();
        app.init_resource::<BufferStore>();
        app.init_resource::<EventStore>();

        // Allocate two edge buffers and one initial (no-edge) entry.
        let (edge_a, edge_b) = {
            let mut buf = app.world_mut().resource_mut::<BufferStore>();
            (buf.new_u8(vec![1, 2, 3, 4]), buf.new_u8(vec![5, 6, 7, 8]))
        };

        let entity = app
            .world_mut()
            .spawn(HillshadeBackfillEvents {
                events: vec![
                    HillshadeBackfillEventData {
                        tile_handle: 0,
                        edge_data_handle: -1,
                        original_handle: Some(42),
                        target_entity: None,
                        edge_direction: 255,
                        elevation_decoder: None,
                    },
                    HillshadeBackfillEventData {
                        tile_handle: 0,
                        edge_data_handle: edge_a,
                        original_handle: None,
                        target_entity: None,
                        edge_direction: 0,
                        elevation_decoder: None,
                    },
                    HillshadeBackfillEventData {
                        tile_handle: 0,
                        edge_data_handle: edge_b,
                        original_handle: None,
                        target_entity: None,
                        edge_direction: 1,
                        elevation_decoder: None,
                    },
                ],
            })
            .id();

        app.add_systems(Update, cleanup_hillshade_backfill_events);

        // First pass: marker is inserted, no buffers freed yet.
        app.update();
        let buf = app.world().resource::<BufferStore>();
        assert!(buf.contains(&edge_a));
        assert!(buf.contains(&edge_b));
        assert!(
            app.world()
                .get::<HillshadeEventsExtracted>(entity)
                .is_some()
        );

        // Second pass: component is removed and edge handles freed.
        app.update();
        let buf = app.world().resource::<BufferStore>();
        assert!(
            !buf.contains(&edge_a),
            "edge_a should be freed after cleanup"
        );
        assert!(
            !buf.contains(&edge_b),
            "edge_b should be freed after cleanup"
        );
        assert!(app.world().get::<HillshadeBackfillEvents>(entity).is_none());
    }

    #[test]
    fn emit_hillshade_canceled_fires_only_for_marked_entities() {
        use bevy_app::App;
        use bevy_app::Update;

        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.init_resource::<BufferStore>();

        // Marked: should emit and have the marker drained.
        let marked = app
            .world_mut()
            .spawn((Deleted, HillshadeTextureMarker, HillshadeCancelRequested))
            .id();
        // Deleted hillshade entity WITHOUT the request marker: must not emit
        // (e.g., deletion paths outside RasterTile::destroy).
        let unmarked = app
            .world_mut()
            .spawn((Deleted, HillshadeTextureMarker))
            .id();

        app.add_systems(Update, emit_hillshade_canceled);

        app.update();

        let events = app.world().resource::<EventStore>();
        assert_eq!(events.hillshade_canceled, vec![marked]);
        assert!(
            app.world()
                .get::<HillshadeCancelRequested>(marked)
                .is_none(),
            "marker should be drained after emission"
        );
        // Unmarked entity stays untouched.
        assert!(app.world().get::<Deleted>(unmarked).is_some());

        // Second pass: nothing left to emit, no re-fire.
        app.world_mut()
            .resource_mut::<EventStore>()
            .hillshade_canceled
            .clear();
        app.update();
        let events = app.world().resource::<EventStore>();
        assert!(events.hillshade_canceled.is_empty());
    }

    /// A backfill emitted earlier in the frame is dropped when it targets an
    /// entity cancelled in the same frame; one targeting a live entity stays.
    #[test]
    fn emit_hillshade_canceled_drops_same_frame_backfills_for_cancelled_entities() {
        use bevy_app::App;
        use bevy_app::Update;

        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.init_resource::<BufferStore>();

        let cancelled = app
            .world_mut()
            .spawn((Deleted, HillshadeTextureMarker, HillshadeCancelRequested))
            .id();
        let live = app.world_mut().spawn(HillshadeTextureMarker).id();
        let (to_cancelled, to_live) = {
            let mut buf = app.world_mut().resource_mut::<BufferStore>();
            (buf.new_u8(vec![1]), buf.new_u8(vec![2]))
        };
        let edge = |handle, target| HillshadeBackfillEventData {
            tile_handle: 0,
            edge_data_handle: handle,
            original_handle: None,
            target_entity: Some(target),
            edge_direction: 0,
            elevation_decoder: None,
        };
        let initial = HillshadeBackfillEventData {
            tile_handle: 0,
            edge_data_handle: -1,
            original_handle: Some(7),
            target_entity: None,
            edge_direction: 255,
            elevation_decoder: None,
        };
        // `live` loaded this frame and sent an edge to each neighbor.
        app.world_mut()
            .entity_mut(live)
            .insert(HillshadeBackfillEvents {
                events: vec![edge(to_cancelled, cancelled), edge(to_live, live)],
            });
        // `cancelled` loaded this frame too, then was destroyed.
        app.world_mut()
            .entity_mut(cancelled)
            .insert(HillshadeBackfillEvents {
                events: vec![initial],
            });
        app.world_mut()
            .resource_mut::<EventStore>()
            .hillshade_backfilled
            .extend([live, cancelled]);

        app.add_systems(Update, emit_hillshade_canceled);
        app.update();

        let world = app.world();
        let kept = &world.get::<HillshadeBackfillEvents>(live).unwrap().events;
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].edge_data_handle, to_live);
        assert!(
            world
                .get::<HillshadeBackfillEvents>(cancelled)
                .unwrap()
                .events
                .is_empty()
        );
        let buf = world.resource::<BufferStore>();
        assert!(!buf.contains(&to_cancelled));
        assert!(buf.contains(&to_live));
    }
}

#[cfg(test)]
mod load_gate_tests {
    use super::*;
    use bevy_app::{App, Update};
    use navara_core::TileXYZ;
    use navara_data_requester::RequestLimits;
    use navara_memory::{MemoryLedger, SsePressure};
    use navara_tile_component::TerrainTile;

    fn setup(gate_closed: bool) -> (App, Entity) {
        let mut app = App::new();
        app.init_resource::<RequestLimits>();
        app.init_resource::<MemoryLedger>();
        app.init_resource::<navara_memory::ReserveEstimates>();
        app.insert_resource(SsePressure {
            multiplier: 1.0,
            load_gate_closed: gate_closed,
            ..Default::default()
        });

        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| TerrainTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();
        app.insert_resource(qt);

        let e = app
            .world_mut()
            .spawn((
                DataRequester::default(),
                TileTextureFragmentMarker(handle),
                HillshadeTextureMarker,
                OrderByDistance {
                    sse: 0.0,
                    distance: 0.0,
                },
                Priority::High,
            ))
            .id();

        app.add_systems(Update, filter_requestable_hillshade_data_requester);
        (app, e)
    }

    #[test]
    fn closed_gate_rejects_new_request() {
        let (mut app, e) = setup(true);
        // `Added` sees the previous frame; two ticks so the filter observes it.
        app.update();
        app.update();
        assert!(app.world().get::<Deleted>(e).is_some());
    }

    #[test]
    fn open_gate_admits_new_request() {
        let (mut app, e) = setup(false);
        app.update();
        app.update();
        assert!(app.world().get::<Deleted>(e).is_none());
    }
}

#[cfg(test)]
mod reservation_tests {
    use super::*;
    use bevy_app::{App, PreUpdate, Update};
    use navara_core::TileXYZ;
    use navara_data_requester::{RequestLimits, remove_removed_data_requesters};
    use navara_memory::{MemoryLedger, ReservedCost, SsePressure};
    use navara_tile_component::TerrainTile;

    /// Budget-enabled app with `max_pendings = 1` so exactly one of two
    /// hillshade requesters is admitted (reserved) and the other rejected.
    fn setup() -> (App, Vec<Entity>) {
        let mut app = App::new();
        app.insert_resource(RequestLimits { max_pendings: 1 });
        app.insert_resource(MemoryLedger {
            budget_bytes: Some(1_000_000_000),
            ..Default::default()
        });
        app.init_resource::<navara_memory::ReserveEstimates>();
        app.init_resource::<SsePressure>();

        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| TerrainTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();
        app.insert_resource(qt);

        let entities: Vec<Entity> = (0..2)
            .map(|i| {
                app.world_mut()
                    .spawn((
                        DataRequester::default(),
                        TileTextureFragmentMarker(handle),
                        HillshadeTextureMarker,
                        OrderByDistance {
                            sse: i as f64,
                            distance: i as f64,
                        },
                        Priority::High,
                    ))
                    .id()
            })
            .collect();

        app.add_systems(Update, filter_requestable_hillshade_data_requester);
        (app, entities)
    }

    #[test]
    fn dispatched_requester_gets_a_reservation_skipped_does_not() {
        let (mut app, entities) = setup();
        // `Added` sees the previous frame; two ticks so the filter observes it.
        app.update();
        app.update();

        let seed = app
            .world()
            .resource::<MemoryLedger>()
            .cost_hints
            .hillshade_reserve_seed();
        let reserved: Vec<_> = entities
            .iter()
            .filter(|e| app.world().get::<ReservedCost>(**e).is_some())
            .collect();
        let deleted: Vec<_> = entities
            .iter()
            .filter(|e| app.world().get::<Deleted>(**e).is_some())
            .collect();
        assert_eq!(reserved.len(), 1, "one dispatched requester is reserved");
        assert_eq!(deleted.len(), 1, "one requester is rejected");
        // Cold estimator: the reservation equals the derived hillshade seed.
        assert_eq!(app.world().resource::<MemoryLedger>().reserved_bytes, seed);
    }

    #[test]
    fn despawn_while_pending_releases_the_reservation() {
        // Abort path: a still-`Pending` hillshade requester marked `Deleted`
        // despawns via `remove_removed_data_requesters`; the `ReservedCost`
        // on_remove hook must release its bytes.
        let mut app = App::new();
        app.init_resource::<navara_buffer_store::BufferStore>();
        app.init_resource::<navara_data_requester::DataManager>();
        app.init_resource::<navara_event_store::EventStore>();
        app.init_resource::<MemoryLedger>();
        app.add_systems(PreUpdate, remove_removed_data_requesters);

        let e = app
            .world_mut()
            .spawn((
                DataRequester::default(),
                HillshadeTextureMarker,
                ReservedCost::fixed(4096),
            ))
            .id();
        assert_eq!(app.world().resource::<MemoryLedger>().reserved_bytes, 4096);

        app.world_mut().entity_mut(e).insert(Deleted);
        app.update();

        assert!(app.world().get_entity(e).is_err(), "requester despawned");
        assert_eq!(app.world().resource::<MemoryLedger>().reserved_bytes, 0);
    }
}
