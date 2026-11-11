import { generate_id_from_entity } from "@navaramap/core";
import type { EntityEvent, HillshadeBackfilledEvent } from "@navaramap/engine";

import type { TileMesh } from "../mesh/tile";
import { getTextureFragmentSlots } from "../utils/textureFragmentIndex";

import type { EventContext } from "./context";
import type { HillshadeContext } from "./HillshadeContext";

/**
 * Resolve the entity ID that hillshade state is keyed by.
 * For edge updates with target_entity_ind/gen, use the target.
 * Otherwise fall back to the event's own entity.
 */
export function resolveHillshadeEntityId(
  event: HillshadeBackfilledEvent,
): string {
  if (
    event.target_entity_ind !== undefined &&
    event.target_entity_gen !== undefined
  ) {
    return `${event.target_entity_ind}_${event.target_entity_gen}`;
  }
  return generate_id_from_entity(event);
}

/**
 * Create padded DEM data (CPU only, no GPU upload)
 * @returns { data, paddedSize } or undefined if invalid
 */
function createPaddedDemData(
  originalBytes: Uint8Array,
): { data: Uint8Array; paddedSize: number } | undefined {
  if (originalBytes.length % 4 !== 0) {
    return undefined;
  }

  const originalSize = Math.sqrt(originalBytes.length / 4);
  if (!Number.isInteger(originalSize) || originalSize < 1) {
    return undefined;
  }

  const paddedSize = originalSize + 2;
  const paddedBytes = new Uint8Array(paddedSize * paddedSize * 4);

  const rowBytes = originalSize * 4;
  for (let y = 0; y < originalSize; y++) {
    const srcRowStart = y * rowBytes;
    const dstRowStart = (y + 1) * paddedSize * 4 + 4;
    paddedBytes.set(
      originalBytes.subarray(srcRowStart, srcRowStart + rowBytes),
      dstRowStart,
    );
  }

  replicateEdgesToPadding(paddedBytes, paddedSize);

  return { data: paddedBytes, paddedSize };
}

/**
 * Apply pending edges that arrived before texture creation.
 * @returns Array of { direction, bytes } for each successfully applied edge
 */
function applyPendingEdges(
  demData: Uint8Array,
  paddedSize: number,
  hillshadeContext: HillshadeContext,
  entityId: string,
): { direction: number; bytes: Uint8Array }[] {
  const applied: { direction: number; bytes: Uint8Array }[] = [];
  const pending = hillshadeContext.pendingEdges.get(entityId);

  if (!pending || pending.size === 0) {
    return applied;
  }

  for (const [edgeDirection, edgeBytes] of pending) {
    const edgeSize = edgeBytes.length / 4;
    const expectedTexSize = edgeSize + 2;

    if (paddedSize === expectedTexSize) {
      updatePaddingEdge(demData, edgeBytes, paddedSize, edgeDirection);
      applied.push({ direction: edgeDirection, bytes: edgeBytes });
    }
  }

  hillshadeContext.pendingEdges.delete(entityId);

  return applied;
}

/**
 * Rebind textures to all meshes using this entity
 */
function rebindTexturesForEntity(entityId: string, ctx: EventContext): void {
  const { textureFragmentIndex, loadedTexs, textureOptions } = ctx;

  // These are guaranteed to exist by validation in processHillshadeBackfilled
  if (!textureFragmentIndex || !loadedTexs || !textureOptions) {
    return;
  }

  const slots = getTextureFragmentSlots(textureFragmentIndex, entityId);
  if (!slots) return;

  // Deduplicate tileMeshes: same mesh may appear in multiple slots
  const uniqueMeshes = new Set<TileMesh>();
  for (const { tileMesh } of slots) {
    uniqueMeshes.add(tileMesh);
  }

  for (const tileMesh of uniqueMeshes) {
    tileMesh.rebindTextures(loadedTexs, textureOptions);
  }
}

/**
 * Process initial hillshade texture creation
 */
function processInitialHillshadeTexture(
  ctx: EventContext,
  event: HillshadeBackfilledEvent,
  entityId: string,
): void {
  const { loadedTexs, buf, tileHandler, hillshadeContext } = ctx;

  // These are guaranteed to exist by validation in processHillshadeBackfilled
  if (!loadedTexs || !buf || !tileHandler || !hillshadeContext) {
    return;
  }

  // Validate original_handle exists
  const originalHandle = event.original_handle;
  if (originalHandle === undefined || originalHandle === null) {
    return;
  }

  // Read data without removing - DataManager handles cleanup via reference counting
  // When multiple consumers (terrain, hillshade) share the same URL, the data is shared.
  // Reference count is decremented when each consumer entity is deleted.
  // Only when ref count reaches 0 (last consumer removed) is the data actually deleted.
  // buf.u8 returns a short-lived view into WASM memory; createPaddedDemData
  // copies it synchronously below, so no further copy is needed.
  const originalBytes = buf.u8(originalHandle);
  if (!originalBytes) {
    return;
  }

  // Create padded DEM data (CPU only, no GPU upload)
  const padded = createPaddedDemData(originalBytes);
  if (!padded) {
    return;
  }
  const { data: demData, paddedSize } = padded;

  // Get tile handle for calculations
  const tileHandleBigInt =
    typeof event.tile_handle === "bigint"
      ? event.tile_handle
      : BigInt(event.tile_handle);

  // Get tile info for zoom level (validate before doing expensive work)
  const tile = tileHandler.getTile(tileHandleBigInt);
  if (!tile) {
    return;
  }

  // Apply any pending edge updates that arrived before texture creation
  const appliedEdges = applyPendingEdges(
    demData,
    paddedSize,
    hillshadeContext,
    entityId,
  );

  const metersPerTexel = tileHandler.calcMetersPerTexel(
    tileHandleBigInt,
    tile.coords.z,
    paddedSize,
  );

  const hillshadeConfig = hillshadeContext.getHillshadeConfig(
    tileHandler,
    tileHandleBigInt,
    event.elevation_decoder,
  );

  const contentWidth = paddedSize - 2;
  const contentHeight = paddedSize - 2;

  // Sanity check: in normal flow, loadedTexs should not have this entity yet
  if (loadedTexs.has(entityId)) {
    console.warn(
      `[Hillshade] Unexpected: loadedTexs already contains ${entityId}, cleaning up`,
    );
    hillshadeContext.clearRenderTarget(entityId);
    loadedTexs.delete(entityId);
  }

  // Generate normal map (DEM is uploaded transiently and freed after render)
  const normalMap = hillshadeContext.generateNormalMap(
    entityId,
    ctx.viewContext,
    demData,
    paddedSize,
    metersPerTexel,
    hillshadeConfig,
    contentWidth,
    contentHeight,
  );

  loadedTexs.set(entityId, normalMap);

  // Store handle-only TempDem entry (no full padded DEM retained)
  hillshadeContext.storeTempDem(
    entityId,
    originalHandle,
    paddedSize,
    metersPerTexel,
    hillshadeConfig,
  );

  // Persist edge bytes so padded DEM can be reconstructed on subsequent edge arrivals
  for (const { direction, bytes } of appliedEdges) {
    hillshadeContext.storeEdgeData(entityId, direction, bytes);
  }

  // Mark the edges that were already applied from pending as received
  for (const { direction } of appliedEdges) {
    const allEdgesReceived = hillshadeContext.markEdgeReceived(
      entityId,
      direction,
    );
    if (allEdgesReceived) {
      hillshadeContext.clearTempDem(entityId);
      break;
    }
  }

  // Rebind textures to update the meshes
  rebindTexturesForEntity(entityId, ctx);
}

/**
 * Process hillshade edge update
 */
function processHillshadeEdgeUpdate(
  ctx: EventContext,
  event: HillshadeBackfilledEvent,
  entityId: string,
): void {
  const { loadedTexs, buf, hillshadeContext } = ctx;

  // These are guaranteed to exist by validation in processHillshadeBackfilled
  if (!loadedTexs || !buf || !hillshadeContext) {
    return;
  }

  // Validate edge_data_handle exists
  const edgeDataHandle = event.edge_data_handle;
  if (edgeDataHandle === undefined || edgeDataHandle === null) {
    return;
  }

  // Read edge data and remove from BufferStore immediately to prevent leaks
  const edgeBytes = buf.removeU8(edgeDataHandle);
  if (!edgeBytes) {
    return;
  }

  // Validate edge data: one edge (size pixels × 4 bytes RGBA)
  if (edgeBytes.length % 4 !== 0) {
    return;
  }

  const texture = loadedTexs.get(entityId);

  if (!texture) {
    // Texture doesn't exist yet - queue this edge update for later application
    let pending = hillshadeContext.pendingEdges.get(entityId);
    if (!pending) {
      pending = new Map<number, Uint8Array>();
      hillshadeContext.pendingEdges.set(entityId, pending);
    }
    // Copy and store edge data, replacing any previous update for this direction
    pending.set(event.edge_direction, new Uint8Array(edgeBytes));
    return;
  }

  // Texture exists (it's a normal map), check if we have the temporary DEM entry
  const tempDemEntry = hillshadeContext.getTempDem(entityId);
  if (!tempDemEntry) {
    // No temp DEM - edge updates complete or timed out, ignore this late arrival
    return;
  }

  const edgeSize = edgeBytes.length / 4;
  const { originalHandle, paddedSize } = tempDemEntry;

  // Texture should be padded (edgeSize + 2)
  const expectedTexSize = edgeSize + 2;
  if (paddedSize !== expectedTexSize) {
    // Size mismatch - different zoom levels, discard this edge data
    return;
  }

  // Store edge bytes for reconstruction on future edge arrivals
  hillshadeContext.storeEdgeData(
    entityId,
    event.edge_direction,
    new Uint8Array(edgeBytes),
  );

  // Mark this edge as received
  const allEdgesReceived = hillshadeContext.markEdgeReceived(
    entityId,
    event.edge_direction,
  );

  // Re-read the original DEM from WASM buffer (reference-counted, still valid).
  // The returned view is consumed synchronously by createPaddedDemData below.
  const originalBytes = buf.u8(originalHandle);
  if (originalBytes) {
    // Rebuild the padded DEM transiently, apply all received edges, generate normal map
    const padded = createPaddedDemData(originalBytes);
    if (padded) {
      for (const [dir, storedBytes] of tempDemEntry.receivedEdgeData) {
        updatePaddingEdge(padded.data, storedBytes, padded.paddedSize, dir);
      }

      const contentWidth = padded.paddedSize - 2;
      const contentHeight = padded.paddedSize - 2;
      const updatedTexture = hillshadeContext.generateNormalMap(
        entityId,
        ctx.viewContext,
        padded.data,
        padded.paddedSize,
        tempDemEntry.metersPerTexel,
        tempDemEntry.hillshadeConfig,
        contentWidth,
        contentHeight,
      );
      loadedTexs.set(entityId, updatedTexture);
      // padded.data is released here (no persistent reference kept)
    }
  }

  // If all 4 edges received, cleanup the temporary entry
  if (allEdgesReceived) {
    hillshadeContext.clearTempDem(entityId);
  }

  // Rebind textures to update the meshes
  rebindTexturesForEntity(entityId, ctx);
}

/**
 * Handle a hillshade_canceled event.
 *
 * Drops in-flight backfill state that earlier events created for the
 * canceled entity — queued neighbor edges and the in-progress DEM assembly
 * entry. Backfills of the same tick aimed at it never arrive: the engine
 * drops them when it emits the cancel.
 *
 * Does NOT dispose render targets or `loadedTexs` textures: those belong to
 * the texture-fragment lifecycle and are released by
 * `processTextureFragmentRemoved`. Disposing them here would race against
 * other tiles that may still reference the texture.
 *
 * Idempotent: safe to call when no state exists for the entity.
 */
export function processHillshadeCanceled(
  ctx: EventContext,
  event: EntityEvent | undefined,
) {
  if (!event) return;

  const { hillshadeContext } = ctx;
  if (!hillshadeContext) return;

  const entityId = generate_id_from_entity(event);

  hillshadeContext.pendingEdges.delete(entityId);
  hillshadeContext.clearTempDem(entityId);
}

export function processHillshadeBackfilled(
  ctx: EventContext,
  event: HillshadeBackfilledEvent | undefined,
) {
  if (!event) return;

  const {
    loadedTexs,
    buf,
    textureFragmentIndex,
    textureOptions,
    tileHandler,
    hillshadeContext,
  } = ctx;

  if (
    !loadedTexs ||
    !buf ||
    !tileHandler ||
    !hillshadeContext ||
    !textureOptions ||
    !textureFragmentIndex
  ) {
    return;
  }

  const entityId = resolveHillshadeEntityId(event);

  // 1. Create texture if original data is provided
  if (event.original_handle !== undefined && event.original_handle !== null) {
    processInitialHillshadeTexture(ctx, event, entityId);
  }

  // 2. Update edges if edge data is provided
  if (event.edge_data_handle !== undefined && event.edge_data_handle !== null) {
    processHillshadeEdgeUpdate(ctx, event, entityId);
  }
}

/**
 * TODO: define this function in Rust and use it in web worker
 * Update a padding edge of a padded texture from neighbor edge data
 * @param textureData - The Uint8Array backing the DataTexture (paddedSize×paddedSize×4 bytes)
 * @param edgeBytes - Buffer containing one edge from neighbor (contentSize pixels × 4 bytes RGBA)
 * @param paddedSize - Padded texture size (e.g., 258 for 256×256 content)
 * @param direction - Edge direction: 0=Left, 1=Right, 2=Top, 3=Bottom
 * @internal Exported for testing only
 */
export function updatePaddingEdge(
  textureData: Uint8Array,
  edgeBytes: Uint8Array,
  paddedSize: number,
  direction: number,
): void {
  const contentSize = paddedSize - 2;

  switch (direction) {
    case 0: // Left padding (x=0)
      for (let y = 0; y < contentSize; y++) {
        const srcIdx = y * 4;
        const dstY = y + 1; // Content starts at y=1
        const dstIdx = (dstY * paddedSize + 0) * 4;
        textureData.set(edgeBytes.subarray(srcIdx, srcIdx + 4), dstIdx);
      }
      break;

    case 1: // Right padding (x=paddedSize-1)
      for (let y = 0; y < contentSize; y++) {
        const srcIdx = y * 4;
        const dstY = y + 1;
        const dstX = paddedSize - 1;
        const dstIdx = (dstY * paddedSize + dstX) * 4;
        textureData.set(edgeBytes.subarray(srcIdx, srcIdx + 4), dstIdx);
      }
      break;

    case 2: // Top padding (y=0)
      for (let x = 0; x < contentSize; x++) {
        const srcIdx = x * 4;
        const dstX = x + 1; // Content starts at x=1
        const dstIdx = (0 * paddedSize + dstX) * 4;
        textureData.set(edgeBytes.subarray(srcIdx, srcIdx + 4), dstIdx);
      }
      break;

    case 3: // Bottom padding (y=paddedSize-1)
      for (let x = 0; x < contentSize; x++) {
        const srcIdx = x * 4;
        const dstX = x + 1;
        const dstY = paddedSize - 1;
        const dstIdx = (dstY * paddedSize + dstX) * 4;
        textureData.set(edgeBytes.subarray(srcIdx, srcIdx + 4), dstIdx);
      }
      break;
  }
}

/**
 * TODO: define this function in Rust and use it in web worker
 * Initialize padding by replicating content edges
 * @param paddedBytes - Padded texture data (paddedSize×paddedSize×4 bytes)
 * @param paddedSize - Padded texture size (e.g., 258)
 * @internal Exported for testing only
 */
export function replicateEdgesToPadding(
  paddedBytes: Uint8Array,
  paddedSize: number,
): void {
  const contentSize = paddedSize - 2;

  // Top padding (y=0): copy from first content row (y=1)
  for (let x = 1; x <= contentSize; x++) {
    const srcIdx = (1 * paddedSize + x) * 4;
    const dstIdx = (0 * paddedSize + x) * 4;
    paddedBytes[dstIdx] = paddedBytes[srcIdx];
    paddedBytes[dstIdx + 1] = paddedBytes[srcIdx + 1];
    paddedBytes[dstIdx + 2] = paddedBytes[srcIdx + 2];
    paddedBytes[dstIdx + 3] = paddedBytes[srcIdx + 3];
  }

  // Bottom padding (y=paddedSize-1): copy from last content row (y=contentSize)
  for (let x = 1; x <= contentSize; x++) {
    const srcIdx = (contentSize * paddedSize + x) * 4;
    const dstIdx = ((paddedSize - 1) * paddedSize + x) * 4;
    paddedBytes[dstIdx] = paddedBytes[srcIdx];
    paddedBytes[dstIdx + 1] = paddedBytes[srcIdx + 1];
    paddedBytes[dstIdx + 2] = paddedBytes[srcIdx + 2];
    paddedBytes[dstIdx + 3] = paddedBytes[srcIdx + 3];
  }

  // Left padding (x=0): copy from first content column (x=1)
  for (let y = 1; y <= contentSize; y++) {
    const srcIdx = (y * paddedSize + 1) * 4;
    const dstIdx = (y * paddedSize + 0) * 4;
    paddedBytes[dstIdx] = paddedBytes[srcIdx];
    paddedBytes[dstIdx + 1] = paddedBytes[srcIdx + 1];
    paddedBytes[dstIdx + 2] = paddedBytes[srcIdx + 2];
    paddedBytes[dstIdx + 3] = paddedBytes[srcIdx + 3];
  }

  // Right padding (x=paddedSize-1): copy from last content column (x=contentSize)
  for (let y = 1; y <= contentSize; y++) {
    const srcIdx = (y * paddedSize + contentSize) * 4;
    const dstIdx = (y * paddedSize + (paddedSize - 1)) * 4;
    paddedBytes[dstIdx] = paddedBytes[srcIdx];
    paddedBytes[dstIdx + 1] = paddedBytes[srcIdx + 1];
    paddedBytes[dstIdx + 2] = paddedBytes[srcIdx + 2];
    paddedBytes[dstIdx + 3] = paddedBytes[srcIdx + 3];
  }

  // Corners: copy from adjacent content pixels
  // Top-left (0, 0)
  const tlSrcIdx = (1 * paddedSize + 1) * 4;
  const tlDstIdx = 0;
  paddedBytes[tlDstIdx] = paddedBytes[tlSrcIdx];
  paddedBytes[tlDstIdx + 1] = paddedBytes[tlSrcIdx + 1];
  paddedBytes[tlDstIdx + 2] = paddedBytes[tlSrcIdx + 2];
  paddedBytes[tlDstIdx + 3] = paddedBytes[tlSrcIdx + 3];

  // Top-right (paddedSize-1, 0)
  const trSrcIdx = (1 * paddedSize + contentSize) * 4;
  const trDstIdx = (paddedSize - 1) * 4;
  paddedBytes[trDstIdx] = paddedBytes[trSrcIdx];
  paddedBytes[trDstIdx + 1] = paddedBytes[trSrcIdx + 1];
  paddedBytes[trDstIdx + 2] = paddedBytes[trSrcIdx + 2];
  paddedBytes[trDstIdx + 3] = paddedBytes[trSrcIdx + 3];

  // Bottom-left (0, paddedSize-1)
  const blSrcIdx = (contentSize * paddedSize + 1) * 4;
  const blDstIdx = (paddedSize - 1) * paddedSize * 4;
  paddedBytes[blDstIdx] = paddedBytes[blSrcIdx];
  paddedBytes[blDstIdx + 1] = paddedBytes[blSrcIdx + 1];
  paddedBytes[blDstIdx + 2] = paddedBytes[blSrcIdx + 2];
  paddedBytes[blDstIdx + 3] = paddedBytes[blSrcIdx + 3];

  // Bottom-right (paddedSize-1, paddedSize-1)
  const brSrcIdx = (contentSize * paddedSize + contentSize) * 4;
  const brDstIdx = ((paddedSize - 1) * paddedSize + (paddedSize - 1)) * 4;
  paddedBytes[brDstIdx] = paddedBytes[brSrcIdx];
  paddedBytes[brDstIdx + 1] = paddedBytes[brSrcIdx + 1];
  paddedBytes[brDstIdx + 2] = paddedBytes[brSrcIdx + 2];
  paddedBytes[brDstIdx + 3] = paddedBytes[brSrcIdx + 3];
}
