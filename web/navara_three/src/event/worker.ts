import {
  generate_id_from_entity,
  PolygonMaterialLike,
  TransferablePolygonBatchedFeatureLike,
  TransferableRasterDEMDataLike,
  TransferableTileLike,
  UpsamplableTerrainGeometryLike,
  PolylineMaterialLike,
  TransferablePolylineBatchedFeatureLike,
  ExtentRadianF32Like,
  type ReturnedConstructedTerrainMeshLike,
} from "@navaramap/core";
import {
  ConstructPolygonBatchedFeatureParameters,
  ConstructPolygonBatchedFeatureResult,
  ConstructPolylineBatchedFeatureParameters,
  ConstructPolylineBatchedFeatureResult,
  ConstructTerrainMeshParameters,
  ConstructTerrainMeshResult,
  DelegatedWorkerTasksResult,
  EntityEvent,
  ExtentRadianF32,
  ParseMvtTileParameters,
  ParseMvtTileResult,
  ReconstructableEntity,
  TransferableFloatAttribute,
  TransferableGeometry,
  TransferablePolygonGeometry,
  TransferablePolygonOutlineGeometry,
  TransferablePolylineGeometry,
  TransferableUintAttribute,
  UpsampleTerrainMeshParameters,
  UpsampleTerrainMeshResult,
  Vec3,
  type WorkerTaskDelegatedEvent,
} from "@navaramap/engine";

import { constructPolygonBatchedFeature } from "../tasks/constructPolygonBatchedFeature";
import { constructPolylineBatchedFeature } from "../tasks/constructPolylineBatchedFeature";
import { constructQuantizedMeshTerrainMesh } from "../tasks/constructQuantizedMeshTerrainMesh";
import { constructTerrainMesh } from "../tasks/constructTerrainMesh";
import { parseMvtTile } from "../tasks/parseMvtTile";
import { upsampleQuantizedMeshTerrainMesh } from "../tasks/upsampleQuantizedMeshTerrainMesh";
import { upsampleTerrainMesh } from "../tasks/upsampleTerrainMesh";

import { runDelegatedWorkerTask } from "./workerTaskSettlement";

import type { EventContext } from ".";

export async function processWorkerTaskDelegatedEvent(
  ctx: EventContext,
  event: WorkerTaskDelegatedEvent,
) {
  const id = generate_id_from_entity(event);
  // Every wasm-bindgen getter access allocates a NEW owned wrapper (reading
  // `event.task.<kind>` twice would leak one copy), so read `task` and each
  // params object exactly once and free whatever this dispatch does not
  // consume. `params` and `delegator_id` ownership moves to the process*
  // handler (via `runDelegatedWorkerTask`).
  const task = event.task;
  try {
    const constructTerrainMesh = task.construct_terrain_mesh;
    if (constructTerrainMesh) {
      return await processConstructTerrainMesh(
        ctx,
        id,
        event.bits,
        constructTerrainMesh,
        task.delegator_id,
      );
    }
    const upsampleTerrainMesh = task.upsample_terrain_mesh;
    if (upsampleTerrainMesh) {
      return await processUpsampleTerrainMesh(
        ctx,
        id,
        event.bits,
        upsampleTerrainMesh,
        task.delegator_id,
      );
    }
    const constructPolygon = task.construct_polygon_batched_feature;
    if (constructPolygon) {
      return await processConstructPolygonBatchedFeature(
        ctx,
        id,
        event.bits,
        constructPolygon,
        task.delegator_id,
      );
    }
    const constructPolyline = task.construct_polyline_batched_feature;
    if (constructPolyline) {
      return await processConstructPolylineBatchedFeature(
        ctx,
        id,
        event.bits,
        constructPolyline,
        task.delegator_id,
      );
    }
    const parseMvt = task.parse_mvt_tile;
    if (parseMvt) {
      return await processParseMvtTile(
        ctx,
        id,
        event.bits,
        parseMvt,
        task.delegator_id,
      );
    }
  } finally {
    task.free();
  }
}

export function processWorkerTaskRemovedEvent(
  ctx: EventContext,
  event: EntityEvent,
) {
  const id = generate_id_from_entity(event);
  const promise = ctx.workerPoolPromises.get(id);
  if (promise) {
    ctx.workerPoolPromises.delete(id);
    // `cancel()` rejects the promise (CancellationError) and returns it; the
    // rejection is observed and classified by the dispatch-side
    // `settleWorkerTask`, so it must NOT be awaited here — awaiting would
    // rethrow the cancellation into the event pipeline.
    promise.cancel();
  }
}

/**
 * Read the entity bits out of an owned `ReconstructableEntity` getter clone
 * and free the wrapper. Getter accessors allocate a NEW owned wrapper per
 * read, so callers must pass the single read they made.
 */
function takeEntityBits(entity: ReconstructableEntity): bigint {
  try {
    return entity[0];
  } finally {
    entity.free();
  }
}

/**
 * Copy an owned `ExtentRadianF32` getter clone into a plain
 * `ExtentRadianF32Like` and free the wasm object. Getter accessors allocate a
 * NEW owned wrapper per read, so callers must pass the single read they made.
 */
function intoExtentRadianLike(
  extent: ExtentRadianF32 | undefined,
): ExtentRadianF32Like | undefined {
  if (!extent) return undefined;
  try {
    return new ExtentRadianF32Like(extent);
  } finally {
    extent.free();
  }
}

/**
 * Track BufferStore registrations made while assembling one task result so a
 * bail-out can free everything registered so far: handles are never reused,
 * so an entry orphaned by an early return stays in the BufferStore forever.
 * On the success path the handles move into the delivered result and must
 * NOT be freed.
 */
function trackRegisteredHandles(bufHandler: EventContext["buf"]) {
  const handles: number[] = [];
  return {
    register<T extends number | undefined>(handle: T): T {
      if (handle != null) handles.push(handle);
      return handle;
    },
    free() {
      for (const handle of handles) {
        bufHandler.remove(handle);
      }
    },
  };
}

/**
 * Register a worker terrain result's arrays in the BufferStore and assemble
 * the `TransferableGeometry` (with optional normals and skirt data), returned
 * together with the separately delivered heights handle. When a required
 * registration fails, the entries registered before it are freed and
 * `undefined` is returned.
 */
function buildTerrainTransferableGeometry(
  bufHandler: EventContext["buf"],
  result: ReturnedConstructedTerrainMeshLike,
): { geometry: TransferableGeometry; heights: number } | undefined {
  // Rust reads none of these terrain arrays (only their handles + byte counts),
  // so adopt them JS-side (zero-copy) instead of copying into WASM memory.
  const registered = trackRegisteredHandles(bufHandler);
  const vertices = registered.register(bufHandler.adoptF32(result.vertices));
  const uvs = registered.register(bufHandler.adoptF32(result.uvs));
  const indices = registered.register(bufHandler.adoptU32(result.indices));
  const heights = registered.register(bufHandler.adoptF32(result.heights));
  if (vertices == null || uvs == null || indices == null || heights == null) {
    registered.free();
    return undefined;
  }

  const geometry = new TransferableGeometry(vertices, uvs, indices);

  if (result.normals) {
    const normals = bufHandler.adoptF32(result.normals);
    if (normals != null) geometry.normals = normals;
  }

  // Set skirt data if available
  if (result.skirt_vertices && result.skirt_uvs && result.skirt_indices) {
    const skirtVertices = bufHandler.adoptF32(result.skirt_vertices);
    const skirtUvs = bufHandler.adoptF32(result.skirt_uvs);
    const skirtIndices = bufHandler.adoptU32(result.skirt_indices);
    const skirtNormals = result.skirt_normals
      ? bufHandler.adoptF32(result.skirt_normals)
      : undefined;

    if (skirtVertices != null) {
      geometry.skirt_vertices = skirtVertices;
    }
    if (skirtUvs != null) {
      geometry.skirt_uvs = skirtUvs;
    }
    if (skirtIndices != null) {
      geometry.skirt_indices = skirtIndices;
    }
    if (skirtNormals != null) {
      geometry.skirt_normals = skirtNormals;
    }
  }

  return { geometry, heights };
}

async function processConstructTerrainMesh(
  ctx: EventContext,
  id: string,
  bits: bigint,
  params: ConstructTerrainMeshParameters,
  delegator_id: ReconstructableEntity,
) {
  const { buf: bufHandler, tileHandler, workerTaskHandler } = ctx;
  await runDelegatedWorkerTask(
    ctx,
    id,
    bits,
    "construct terrain mesh",
    params,
    delegator_id,
    async (task) => {
      // buf.u8 returns a short-lived view into WASM memory; copy it since the
      // bytes are transferred to the worker (a view's buffer is the whole WASM
      // memory and is not detachable).
      const bytes = bufHandler.u8(params.bytes_handle)?.slice();
      if (!bytes) {
        return;
      }

      const tile = tileHandler.getTile(params.tile_handle);
      if (!tile) {
        return;
      }

      let promise: ReturnType<
        typeof constructQuantizedMeshTerrainMesh | typeof constructTerrainMesh
      >;
      if (params.isQuantizedMesh) {
        promise = constructQuantizedMeshTerrainMesh(
          bytes,
          new TransferableTileLike(tile),
          params.skirt,
          params.skirtExaggeration,
          params.poleNorth,
          params.poleSouth,
          params.geographic,
          params.tms,
        );
      } else {
        const elevationDecoder = tileHandler.getTileElevationDecoder(
          params.tile_handle,
        );
        if (!elevationDecoder) {
          return;
        }
        promise = constructTerrainMesh(
          bytes,
          new TransferableTileLike(tile),
          new TransferableRasterDEMDataLike(elevationDecoder),
          params.tile_size,
          params.skirt,
          params.skirtExaggeration,
          params.poleNorth,
          params.poleSouth,
        );
      }
      const settled = await task.settle(promise);
      if (!settled) return;
      const { result } = settled;

      if (!workerTaskHandler.hasWorkerTask(delegator_id[0])) return;

      const built = buildTerrainTransferableGeometry(bufHandler, result);
      if (!built) return;
      const { geometry, heights } = built;

      const rtcTranslation = result.rtc_translation;
      const watermaskHandle = result.watermask
        ? bufHandler.adoptU8(result.watermask)
        : undefined;

      const constructTerrainMeshResult = new ConstructTerrainMeshResult(
        geometry,
        heights,
        result.min_height,
        result.max_height,
        rtcTranslation
          ? new Vec3(rtcTranslation.x, rtcTranslation.y, rtcTranslation.z)
          : undefined,
      );
      if (watermaskHandle != null) {
        constructTerrainMeshResult.watermask = watermaskHandle;
      }

      task.complete((delegator_id) =>
        DelegatedWorkerTasksResult.withConstructTerrainMesh(
          delegator_id,
          constructTerrainMeshResult,
        ),
      );
    },
  );
}

async function processUpsampleTerrainMesh(
  ctx: EventContext,
  id: string,
  bits: bigint,
  params: UpsampleTerrainMeshParameters,
  delegator_id: ReconstructableEntity,
) {
  const { buf: bufHandler, tileHandler, workerTaskHandler } = ctx;
  await runDelegatedWorkerTask(
    ctx,
    id,
    bits,
    "upsample terrain mesh",
    params,
    delegator_id,
    async (task) => {
      const tile = tileHandler.getTile(params.tile_handle);
      if (!tile) {
        return;
      }
      const parentTile = tileHandler.getParentTile(params.tile_handle);
      if (!parentTile) {
        return;
      }

      const cachedMeshHandle = parentTile.cached_mesh_handle;
      if (!cachedMeshHandle || !cachedMeshHandle.heights) {
        return;
      }

      // buf.* return short-lived views into WASM memory; copy them since the
      // parent geometry is sent to the worker (a view's buffer is the whole
      // WASM memory and is not transferable).
      const parentUvs = bufHandler.f32(cachedMeshHandle.uvs)?.slice();
      const parentIndices = bufHandler.u32(cachedMeshHandle.indices)?.slice();
      const parentHeights = bufHandler.f32(cachedMeshHandle.heights)?.slice();
      if (!parentUvs || !parentIndices || !parentHeights) {
        return;
      }

      const parentNormalsHandle = cachedMeshHandle.normals;
      const parentNormals =
        parentNormalsHandle != null
          ? bufHandler.f32(parentNormalsHandle)?.slice()
          : undefined;

      const parentWatermaskHandle = cachedMeshHandle.watermask;
      const parentWatermask =
        parentWatermaskHandle != null
          ? bufHandler.u8(parentWatermaskHandle)?.slice()
          : undefined;

      const upsamplableTerrainGeometry = new UpsamplableTerrainGeometryLike(
        parentUvs,
        parentIndices,
        parentHeights,
        parentNormals,
        parentWatermask,
      );

      let promise: ReturnType<
        typeof upsampleQuantizedMeshTerrainMesh | typeof upsampleTerrainMesh
      >;
      if (params.isQuantizedMesh) {
        promise = upsampleQuantizedMeshTerrainMesh(
          new TransferableTileLike(tile),
          new TransferableTileLike(parentTile),
          upsamplableTerrainGeometry,
          params.skirt,
          params.skirtExaggeration,
          params.poleNorth,
          params.poleSouth,
          params.geographic,
          params.tms,
        );
      } else {
        const elevationDecoder = tileHandler.getTileElevationDecoder(
          params.tile_handle,
        );
        if (!elevationDecoder) {
          return;
        }
        promise = upsampleTerrainMesh(
          new TransferableTileLike(tile),
          new TransferableTileLike(parentTile),
          new TransferableRasterDEMDataLike(elevationDecoder),
          upsamplableTerrainGeometry,
          params.skirt,
          params.skirtExaggeration,
          params.poleNorth,
          params.poleSouth,
          params.tms,
        );
      }
      const result = await task.settle(promise);
      if (!result) return;

      if (!workerTaskHandler.hasWorkerTask(delegator_id[0])) return;

      const built = buildTerrainTransferableGeometry(bufHandler, result);
      if (!built) return;
      const { geometry, heights } = built;

      const rtcTranslation = result.rtc_translation;
      const watermaskHandle = result.watermask
        ? bufHandler.adoptU8(result.watermask)
        : undefined;

      const upsampleTerrainMeshResult = new UpsampleTerrainMeshResult(
        geometry,
        heights,
        result.min_height,
        result.max_height,
        rtcTranslation
          ? new Vec3(rtcTranslation.x, rtcTranslation.y, rtcTranslation.z)
          : undefined,
      );
      if (watermaskHandle != null) {
        upsampleTerrainMeshResult.watermask = watermaskHandle;
      }

      task.complete((delegator_id) =>
        DelegatedWorkerTasksResult.withUpsampleTerrainMesh(
          delegator_id,
          upsampleTerrainMeshResult,
        ),
      );
    },
  );
}

async function processConstructPolygonBatchedFeature(
  ctx: EventContext,
  id: string,
  bits: bigint,
  params: ConstructPolygonBatchedFeatureParameters,
  delegator_id: ReconstructableEntity,
) {
  const { buf: bufHandler, featureHandler, workerTaskHandler } = ctx;
  await runDelegatedWorkerTask(
    ctx,
    id,
    bits,
    "construct polygon batched feature",
    params,
    delegator_id,
    async (task) => {
      const transferable = featureHandler.getTransferablePolygonBatchedFeature(
        takeEntityBits(params.batched_feature),
      );

      if (!transferable) return;

      // The Like constructors copy every array and field out of WASM memory,
      // and `material` is a getter_with_clone accessor whose every read
      // allocates a new owned wrapper: read it once and free both wasm
      // objects as soon as the copies exist.
      let featureLike: TransferablePolygonBatchedFeatureLike;
      let materialLike: PolygonMaterialLike;
      try {
        featureLike = new TransferablePolygonBatchedFeatureLike(transferable);
        const material = transferable.material;
        try {
          materialLike = new PolygonMaterialLike(material);
        } finally {
          material.free();
        }
      } finally {
        transferable.free();
      }

      const promise = constructPolygonBatchedFeature(
        featureLike,
        materialLike,
        params.flat,
        intoExtentRadianLike(params.tile_extent),
      );
      const result = await task.settle(promise);
      if (!result) return;

      if (!workerTaskHandler.hasWorkerTask(delegator_id[0])) return;

      // Rust reads none of these polygon draw attributes (only handles + byte
      // counts), so adopt them JS-side (zero-copy) rather than copy into WASM.
      // Exception: batch_id must stay WASM-resident — when a feature is
      // evicted before JS consumes the geometry, Rust's
      // `TransferablePolygonGeometry::remove_buffers` reads its contents to
      // purge the `BatchTable`, and an External entry would silently skip
      // that purge and leak the table rows.
      const registered = trackRegisteredHandles(bufHandler);
      const batchId = result.batch_id
        ? registered.register(bufHandler.newF32(result.batch_id))
        : undefined;
      const batchIndex = result.batch_index
        ? registered.register(bufHandler.adoptU32(result.batch_index))
        : undefined;
      const normal = result.normal
        ? registered.register(bufHandler.adoptF32(result.normal))
        : undefined;
      const position = result.position
        ? registered.register(bufHandler.adoptF32(result.position))
        : undefined;
      const position3dHigh = result.position_3d_high
        ? registered.register(bufHandler.adoptF32(result.position_3d_high))
        : undefined;
      const position3dLow = result.position_3d_low
        ? registered.register(bufHandler.adoptF32(result.position_3d_low))
        : undefined;
      const scaleNormalAndCap = result.scale_normal_and_cap
        ? registered.register(bufHandler.adoptF32(result.scale_normal_and_cap))
        : undefined;
      const indices = registered.register(bufHandler.adoptU32(result.indices));
      if (!indices) {
        registered.free();
        return;
      }
      // Either position or (position_3d_high and position_3d_low) must be present
      if (!position && (!position3dHigh || !position3dLow)) {
        registered.free();
        return;
      }

      const transferableBatchId = batchId
        ? new TransferableFloatAttribute(batchId, result.batch_id_size ?? 0)
        : undefined;
      const transferableBatchIndex = batchIndex
        ? new TransferableUintAttribute(
            batchIndex,
            result.batch_index_size ?? 0,
          )
        : undefined;
      const transferableNormal = normal
        ? new TransferableFloatAttribute(normal, result.normal_size ?? 0)
        : undefined;
      const transferablePosition = position
        ? new TransferableFloatAttribute(position, result.position_size ?? 0)
        : undefined;
      const transferablePosition3dHigh = position3dHigh
        ? new TransferableFloatAttribute(
            position3dHigh,
            result.position_3d_high_size ?? 0,
          )
        : undefined;
      const transferablePosition3dLow = position3dLow
        ? new TransferableFloatAttribute(
            position3dLow,
            result.position_3d_low_size ?? 0,
          )
        : undefined;
      const transferableScaleNormalAndCap = scaleNormalAndCap
        ? new TransferableFloatAttribute(
            scaleNormalAndCap,
            result.scale_normal_and_cap_size ?? 0,
          )
        : undefined;
      const geometry = new TransferablePolygonGeometry(
        transferablePosition,
        transferablePosition3dHigh,
        transferablePosition3dLow,
        transferableNormal,
        transferableScaleNormalAndCap,
        transferableBatchId,
        transferableBatchIndex,
        indices,
      );

      // Construct outline geometry if present
      let outlineGeometry: TransferablePolygonOutlineGeometry | undefined;
      if (result.outline_position) {
        const outlinePosition = bufHandler.adoptF32(result.outline_position);
        const outlinePosition3dHigh = result.outline_position_3d_high
          ? bufHandler.adoptF32(result.outline_position_3d_high)
          : undefined;
        const outlinePosition3dLow = result.outline_position_3d_low
          ? bufHandler.adoptF32(result.outline_position_3d_low)
          : undefined;
        const outlineScaleNormalAndCap = result.outline_scale_normal_and_cap
          ? bufHandler.adoptF32(result.outline_scale_normal_and_cap)
          : undefined;
        const outlineSkipIndices = result.outline_skip_indices
          ? bufHandler.adoptU32(result.outline_skip_indices)
          : undefined;

        const outlineBatchIndex = result.outline_batch_index
          ? bufHandler.adoptF32(result.outline_batch_index)
          : undefined;

        outlineGeometry = new TransferablePolygonOutlineGeometry(
          outlinePosition
            ? new TransferableFloatAttribute(
                outlinePosition,
                result.outline_position_size ?? 3,
              )
            : undefined,
          outlinePosition3dHigh
            ? new TransferableFloatAttribute(
                outlinePosition3dHigh,
                result.outline_position_3d_high_size ?? 3,
              )
            : undefined,
          outlinePosition3dLow
            ? new TransferableFloatAttribute(
                outlinePosition3dLow,
                result.outline_position_3d_low_size ?? 3,
              )
            : undefined,
          outlineScaleNormalAndCap
            ? new TransferableFloatAttribute(
                outlineScaleNormalAndCap,
                result.outline_scale_normal_and_cap_size ?? 4,
              )
            : undefined,
          outlineSkipIndices,
          outlineBatchIndex
            ? new TransferableFloatAttribute(
                outlineBatchIndex,
                result.outline_batch_index_size ?? 1,
              )
            : undefined,
        );
      }

      const extent = result.extent;
      const rtc_translation = result.rtc_translation;
      const constructPolygonBatchedFeatureResult =
        new ConstructPolygonBatchedFeatureResult(
          geometry,
          outlineGeometry,
          extent
            ? new ExtentRadianF32(
                extent.west,
                extent.south,
                extent.east,
                extent.north,
              )
            : undefined,

          rtc_translation
            ? new Vec3(rtc_translation.x, rtc_translation.y, rtc_translation.z)
            : undefined, // RTC translation from worker
        );

      task.complete((delegator_id) =>
        DelegatedWorkerTasksResult.withConstructPolygonBatchedFeature(
          delegator_id,
          constructPolygonBatchedFeatureResult,
        ),
      );
    },
  );
}

async function processConstructPolylineBatchedFeature(
  ctx: EventContext,
  id: string,
  bits: bigint,
  params: ConstructPolylineBatchedFeatureParameters,
  delegator_id: ReconstructableEntity,
) {
  const { buf: bufHandler, featureHandler, workerTaskHandler } = ctx;
  await runDelegatedWorkerTask(
    ctx,
    id,
    bits,
    "construct polyline batched feature",
    params,
    delegator_id,
    async (task) => {
      const transferable = featureHandler.getTransferablePolylineBatchedFeature(
        takeEntityBits(params.batched_feature),
      );

      if (!transferable) return;

      // The Like constructors copy every array and field out of WASM memory,
      // and `material` is a getter_with_clone accessor whose every read
      // allocates a new owned wrapper: read it once and free both wasm
      // objects as soon as the copies exist.
      let featureLike: TransferablePolylineBatchedFeatureLike;
      let materialLike: PolylineMaterialLike;
      try {
        featureLike = new TransferablePolylineBatchedFeatureLike(transferable);
        const material = transferable.material;
        try {
          materialLike = new PolylineMaterialLike(material);
        } finally {
          material.free();
        }
      } finally {
        transferable.free();
      }

      const promise = constructPolylineBatchedFeature(
        featureLike,
        materialLike,
        params.flat,
      );
      const result = await task.settle(promise);
      if (!result || !result.batch_id || !result.batch_index) return;

      if (!workerTaskHandler.hasWorkerTask(delegator_id[0])) return;

      // Rust reads none of these polyline draw attributes (only handles + byte
      // counts), so adopt them JS-side (zero-copy) rather than copy into WASM.
      // Exception: batch_id must stay WASM-resident — when a feature is
      // evicted before JS consumes the geometry, Rust's
      // `TransferablePolylineGeometry::remove_buffers` reads its contents to
      // purge the `BatchTable`, and an External entry would silently skip
      // that purge and leak the table rows.
      const registered = trackRegisteredHandles(bufHandler);
      const position = registered.register(
        bufHandler.adoptF32(result.position),
      );
      const positionHigh = result.position_high
        ? registered.register(bufHandler.adoptF32(result.position_high))
        : undefined;
      const positionLow = result.position_low
        ? registered.register(bufHandler.adoptF32(result.position_low))
        : undefined;
      const start = result.start
        ? registered.register(bufHandler.adoptF32(result.start))
        : undefined;
      const startHigh = result.start_high
        ? registered.register(bufHandler.adoptF32(result.start_high))
        : undefined;
      const startLow = result.start_low
        ? registered.register(bufHandler.adoptF32(result.start_low))
        : undefined;
      const startNormals = result.start_normals
        ? registered.register(bufHandler.adoptF32(result.start_normals))
        : undefined;
      const forwardOffset = result.forward_offset
        ? registered.register(bufHandler.adoptF32(result.forward_offset))
        : undefined;
      const endHigh = result.end_high
        ? registered.register(bufHandler.adoptF32(result.end_high))
        : undefined;
      const endLow = result.end_low
        ? registered.register(bufHandler.adoptF32(result.end_low))
        : undefined;
      const endNormalAndTextureCoordinateNormalizationX =
        result.end_normal_and_texture_coordinate_normalization_x
          ? registered.register(
              bufHandler.adoptF32(
                result.end_normal_and_texture_coordinate_normalization_x,
              ),
            )
          : undefined;
      const rightNormalAndTextureCoordinateNormalizationY = registered.register(
        bufHandler.adoptF32(
          result.right_normal_and_texture_coordinate_normalization_y,
        ),
      );
      const batchId = registered.register(bufHandler.newF32(result.batch_id));
      const batchIndex = registered.register(
        bufHandler.adoptU32(result.batch_index),
      );
      const indices = registered.register(bufHandler.adoptU32(result.indices));
      if (
        !batchId ||
        !batchIndex ||
        !position ||
        !rightNormalAndTextureCoordinateNormalizationY ||
        !indices
      ) {
        registered.free();
        return;
      }

      const transferableBatchId = new TransferableFloatAttribute(
        batchId,
        result.batch_id_size ?? 0,
      );
      const transferableBatchIndex = new TransferableUintAttribute(
        batchIndex,
        result.batch_index_size ?? 0,
      );
      const transferablePosition = new TransferableFloatAttribute(
        position,
        result.position_size,
      );
      const transferablePositionHigh = positionHigh
        ? new TransferableFloatAttribute(
            positionHigh,
            result.position_high_size ?? 0,
          )
        : undefined;
      const transferablePositionLow = positionLow
        ? new TransferableFloatAttribute(
            positionLow,
            result.position_low_size ?? 0,
          )
        : undefined;
      const transferableStart = start
        ? new TransferableFloatAttribute(start, result.start_size ?? 0)
        : undefined;
      const transferableStartHigh = startHigh
        ? new TransferableFloatAttribute(startHigh, result.start_high_size ?? 0)
        : undefined;
      const transferableStartLow = startLow
        ? new TransferableFloatAttribute(startLow, result.start_low_size ?? 0)
        : undefined;
      const transferableEndHigh = endHigh
        ? new TransferableFloatAttribute(endHigh, result.end_high_size ?? 0)
        : undefined;
      const transferableEndLow = endLow
        ? new TransferableFloatAttribute(endLow, result.end_low_size ?? 0)
        : undefined;
      const transferableStartNormals = startNormals
        ? new TransferableFloatAttribute(
            startNormals,
            result.start_normals_size ?? 0,
          )
        : undefined;
      const transferableForwardOffset = forwardOffset
        ? new TransferableFloatAttribute(
            forwardOffset,
            result.forward_offset_size ?? 0,
          )
        : undefined;
      const transferableEndNormalAndTextureCoordinateNormalizationX =
        endNormalAndTextureCoordinateNormalizationX
          ? new TransferableFloatAttribute(
              endNormalAndTextureCoordinateNormalizationX,
              result.end_normal_and_texture_coordinate_normalization_x_size ??
                0,
            )
          : undefined;
      const transferableRightNormalAndTextureCoordinateNormalizationY =
        new TransferableFloatAttribute(
          rightNormalAndTextureCoordinateNormalizationY,
          result.right_normal_and_texture_coordinate_normalization_y_size,
        );

      const geometry = new TransferablePolylineGeometry(
        transferablePosition,
        transferablePositionHigh,
        transferablePositionLow,
        transferableStart,
        transferableStartHigh,
        transferableStartLow,
        transferableForwardOffset,
        transferableEndHigh,
        transferableEndLow,
        transferableStartNormals,
        transferableEndNormalAndTextureCoordinateNormalizationX,
        transferableRightNormalAndTextureCoordinateNormalizationY,
        transferableBatchId,
        transferableBatchIndex,
        indices,
      );

      const extent = result.extent;
      const constructPolylineBatchedFeatureResult =
        new ConstructPolylineBatchedFeatureResult(
          geometry,
          extent
            ? new ExtentRadianF32(
                extent.west,
                extent.south,
                extent.east,
                extent.north,
              )
            : undefined,
        );

      task.complete((delegator_id) =>
        DelegatedWorkerTasksResult.withConstructPolylineBatchedFeature(
          delegator_id,
          constructPolylineBatchedFeatureResult,
        ),
      );
    },
  );
}

async function processParseMvtTile(
  ctx: EventContext,
  id: string,
  bits: bigint,
  params: ParseMvtTileParameters,
  delegator_id: ReconstructableEntity,
) {
  const { buf: bufHandler, workerTaskHandler } = ctx;
  await runDelegatedWorkerTask(
    ctx,
    id,
    bits,
    "parse MVT tile",
    params,
    delegator_id,
    async (task) => {
      // Unlike the construct tasks, a parse that fails after dispatch
      // completes with an empty result instead of releasing the delegator:
      // this finalizes the tile with zero features, matching the synchronous
      // path's behavior for an unparseable tile.
      const completeWithEmptyResult = () => {
        task.complete((delegator_id) =>
          DelegatedWorkerTasksResult.withParseMvtTile(
            delegator_id,
            ParseMvtTileResult.empty(),
          ),
        );
      };

      // Move the pbf out of the BufferStore as we hand a copy to the worker:
      // the main thread never reuses it (geometry comes back from the worker),
      // so this avoids keeping the tile's bytes resident on the main thread
      // for the whole parse. (finalize/cancel still call `buf.remove` as a
      // no-op safety net for tasks that were cancelled before ever being
      // dispatched here.)
      const bytes = bufHandler.removeU8(params.pbf_handle);
      if (!bytes) {
        completeWithEmptyResult();
        return;
      }

      const promise = parseMvtTile(
        bytes,
        params.x,
        params.y,
        params.z,
        intoExtentRadianLike(params.tile_extent),
        params.compression,
        params.configs_json,
      );
      // Cancelled (tile evicted while parsing): there is nothing to deliver —
      // the engine already marked the task Deleted.
      const result = await task.settle(promise, completeWithEmptyResult);
      if (!result) return;

      // Nothing is registered in the BufferStore before this check, so a
      // vanished task leaks nothing.
      if (!workerTaskHandler.hasWorkerTask(delegator_id[0])) return;

      // Store the four packed streams in the BufferStore (writing straight
      // into WASM memory) and hand the engine only their handles; the
      // delegated-task system frees them on every path, including a deleted
      // delegator.
      const registered = trackRegisteredHandles(bufHandler);
      const f64Handle = registered.register(
        bufHandler.newF64(result.f64_stream),
      );
      const f32Handle = registered.register(
        bufHandler.newF32(result.f32_stream),
      );
      const u32Handle = registered.register(
        bufHandler.newU32(result.u32_stream),
      );
      const u8Handle = registered.register(bufHandler.newU8(result.u8_stream));
      if (
        f64Handle == null ||
        f32Handle == null ||
        u32Handle == null ||
        u8Handle == null
      ) {
        registered.free();
        completeWithEmptyResult();
        return;
      }

      // The wasm-bindgen constructor deserializes `meta` and can throw (it
      // returns Result on the Rust side). The four handles registered above
      // are owned by nobody until the result reaches the engine, so free them
      // on failure or they stay in the BufferStore forever.
      let parseResult: ParseMvtTileResult;
      try {
        parseResult = new ParseMvtTileResult(
          f64Handle,
          f32Handle,
          u32Handle,
          u8Handle,
          result.meta,
        );
      } catch (err) {
        registered.free();
        console.error("Failed to deserialize MVT tile meta:", err);
        completeWithEmptyResult();
        return;
      }

      task.complete((delegator_id) =>
        DelegatedWorkerTasksResult.withParseMvtTile(delegator_id, parseResult),
      );
    },
  );
}
