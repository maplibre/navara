import {
  generate_id_from_entity,
  IMAGE_EXTENSIONS,
  isEntityEvent,
} from "@navaramap/core";
import {
  type Transform,
  type EntityEvent,
  type ObjectTransformEvent,
  type DataRequestEvent,
  type CameraFrustum,
  TextureFragmentRequestedEvent,
  TextureFragmentStatus,
  DataRequesterRemovedEvent,
  RenderableFeatureRemovedEvent,
  Events,
} from "@navaramap/engine";
import { radianToDegree } from "@navaramap/three-api";
import { canWorkerProcessImmediately } from "@navaramap/worker";
import { Mesh, Object3D, Sprite } from "three";

import { BatchedSdfTextMesh, Layer } from "..";
import { disposeTexture } from "../loaders";
import { getImageDataFromBlob } from "../tasks/getImageDataFromBlob";

import { type EventContext } from "./context";
import {
  checkFeatureParallel,
  processRenderableFeatureAdded,
  processRenderableFeatureChanged,
} from "./feature";
import {
  processHillshadeBackfilled,
  processHillshadeCanceled,
} from "./hillshade";
import { ABORTABLE_TEXTURE_LOADER } from "./loaders";
import {
  processMeshAdded,
  processMeshChanged,
  processMeshGeometryReplaced,
} from "./tile";
import {
  processWorkerTaskDelegatedEvent,
  processWorkerTaskRemovedEvent,
} from "./worker";

export type {
  BufferLoader,
  TextureFragmentHandler,
  WorkerTaskHandler,
  TileHandler,
  GlobeHandler,
  FeatureHandler,
  MeshHandler,
  LayerHandler,
  FlightHandler,
} from "./context";
export { EventContext } from "./context";
export { HillshadeContext } from "./HillshadeContext";

/** Browser fetch priority hint derived from the engine rank (0 = Extreme). */
function fetchPriorityHint(rank: number): RequestPriority {
  if (rank <= 1) return "high";
  if (rank >= 3) return "low";
  return "auto";
}

export function processEvent(ctx: EventContext, event: Events | undefined) {
  const {
    eventManager,
    meshes,
    meshHandler,
    viewEvents,
    layersManager,
    viewContext,
  } = ctx;

  eventManager.pushEvents(event);

  eventManager.forEachStack("camera_transform_updated", (ev) =>
    processCameraTransformUpdated(ctx, ev),
  );

  eventManager.forEachStack("camera_frustum_updated", (ev) =>
    processCameraFrustumUpdated(ctx, ev),
  );

  eventManager.forEachStack("camera_flight_ended", (ev) =>
    ctx.flightHandler(ev.id, ev.completed),
  );

  eventManager.forEachStack("object_transform_updated", (ev) =>
    processObjectTransformUpdated(ctx, ev),
  );

  // Geometry-only swaps (an upsampled terrain mesh replaced by its real DEM)
  // are applied synchronously here, alongside the transform update above, so
  // the mesh never renders new geometry at an old RTC origin or vice versa.
  eventManager.forEachStack(
    "mesh_geometry_replaced",
    (ev) => processMeshGeometryReplaced(ctx, ev),
    Infinity,
  );

  eventManager.forEachStack("update_sample_terrain_height", (ev) =>
    viewEvents.emit("_sample_terrain_height_received", ev),
  );

  // Process cancels before backfills, synchronously. Each cancel drops its
  // own matching pending backfills from the stack (see processHillshadeCanceled),
  // so the subsequent forEachStack only iterates surviving events.
  //
  // Using forEachStack here matches main's per-frame timing — switching this
  // to processTransactionEvents earlier caused hillshade adds to be spread
  // across frames via the TransactionManager chain, which produced visible
  // texture offset during fast pan/zoom.
  eventManager.forEachStack(
    "hillshade_canceled",
    (ev) => processHillshadeCanceled(ctx, ev),
    Infinity,
  );

  eventManager.forEachStack("hillshade_backfilled", (ev) =>
    processHillshadeBackfilled(ctx, ev),
  );

  eventManager.processTransactionEvents(
    "meshEvent",
    {
      add: {
        key: "mesh_added",
      },
      remove: {
        key: "mesh_removed",
        // This process is not heavy for now, so we can process it infinitely.
        max: Infinity,
      },
      change: {
        key: "mesh_updated",
        // This process is not heavy for now, so we can process it infinitely.
        max: Infinity,
      },
    },
    async ({ type, event }) => {
      switch (type) {
        case "add":
          await processMeshAdded(ctx, event);
          meshHandler.setTileMeshPrepared(event.tile_handle);
          break;
        case "remove":
          processObjectRemoved(ctx, event);
          break;
        case "change":
          processMeshChanged(ctx, event);
          break;
      }
    },
    {
      shouldProcess: ({ type }) => {
        switch (type) {
          case "add":
            return canWorkerProcessImmediately();
          case "remove":
            return true;
          case "change":
            return true;
        }
      },
    },
  );

  eventManager.processTransactionEvents(
    "workerTaskEvent",
    {
      add: {
        key: "worker_task_delegated",
        // Most urgent first (0 = Extreme): a terrain mesh task queued this
        // frame overtakes MVT parses still waiting for a free worker.
        order: (a, b) => a.priority - b.priority,
      },
      remove: {
        key: "worker_task_removed",
        max: Infinity,
      },
    },
    async ({ type, event }) => {
      switch (type) {
        case "add":
          await processWorkerTaskDelegatedEvent(ctx, event);
          break;
        case "remove":
          processWorkerTaskRemovedEvent(ctx, event);
          break;
      }
    },
    {
      shouldProcess: ({ type }) => {
        switch (type) {
          case "add":
            return canWorkerProcessImmediately();
          case "remove":
            return true;
          case "change":
            return true;
        }
      },
      onAbort: (event) => {
        processWorkerTaskRemovedEvent(ctx, event);
      },
    },
  );

  eventManager.processTransactionEvents(
    "renderableFeatureEvent",
    {
      add: {
        key: "renderable_feature_added",
      },
      remove: {
        key: "renderable_feature_removed",
        // This process is not heavy for now, so we can process it infinitely.
        max: Infinity,
      },
      change: {
        key: "renderable_feature_changed",
        // This process is not heavy for now, so we can process it infinitely.
        max: Infinity,
      },
    },
    async ({ type, event }) => {
      switch (type) {
        case "add":
          await processRenderableFeatureAdded(ctx, event);
          break;
        case "remove":
          {
            const removed = event as RenderableFeatureRemovedEvent;
            const layer = layersManager.get(removed.layer_id);
            if (layer && layer instanceof Layer) {
              layer._unregisterFeatureEvaluator(removed.bits);
              layer.emit("featureRemoved", { featureSetId: removed.bits });
            }
            processObjectRemoved(ctx, event);
          }
          break;
        case "change":
          await processRenderableFeatureChanged(ctx, event);
          break;
      }
    },
    {
      shouldProcess: ({ type, event }) => {
        switch (type) {
          case "add":
            return (
              !checkFeatureParallel(event.feature) ||
              viewContext.concurrencyManager.canIncrement()
            );
          case "remove":
            return true;
          case "change":
            if (isEntityEvent(event)) {
              const id = generate_id_from_entity(event);
              return meshes.has(id);
            }
            return true;
        }
      },
    },
  );

  eventManager.processTransactionEvents(
    "textureFragmentEvent",
    {
      add: {
        key: "texture_fragment_requested",
      },
      remove: {
        key: "texture_fragment_removed",
        // This process is not heavy for now, so we can process it infinitely.
        max: Infinity,
      },
    },
    async ({ type, event }) => {
      switch (type) {
        case "add":
          await processTextureFragmentRequested(ctx, event);
          break;
        case "remove":
          processTextureFragmentRemoved(ctx, event);
          break;
      }
    },
    {
      onAbort: (event) => {
        processTextureFragmentRemoved(ctx, event);
      },
    },
  );

  eventManager.processTransactionEvents(
    "dataRequesterEvent",
    {
      add: {
        key: "data_requested",
        // Most urgent first (0 = Extreme): a terrain DEM queued this frame
        // goes out before vector/raster tiles still waiting in the stack.
        order: (a, b) => a.priority - b.priority,
      },
      remove: {
        key: "data_requester_removed",
        // This process is not heavy for now, so we can process it infinitely.
        max: Infinity,
      },
    },
    async ({ type, event }) => {
      switch (type) {
        case "add":
          await processRequestedData(ctx, event);
          break;
        case "remove":
          processDataRequesterRemoved(ctx, event);
          break;
      }
    },
    {
      onAbort: (event) => {
        processDataRequesterRemoved(ctx, event);
      },
    },
  );
}

function processCameraTransformUpdated(
  ctx: EventContext,
  transform: Transform | undefined,
) {
  if (!transform) return;
  setTransform(ctx.camera.raw, transform);

  ctx.camera.updateStatus();
}

function processCameraFrustumUpdated(
  ctx: EventContext,
  frustum: CameraFrustum | undefined,
) {
  if (!frustum) return;

  ctx.camera.raw.near = frustum.near;
  ctx.camera.raw.far = frustum.far;
  // The engine's `fov` is the vertical fov, matching what
  // `PerspectiveCamera.fov` expects.
  ctx.camera.raw.fov = radianToDegree(frustum.fov);
  ctx.camera.raw.updateProjectionMatrix();
  ctx.camera.emit("frustumChanged");
}

function processObjectTransformUpdated(
  ctx: EventContext,
  e: ObjectTransformEvent,
) {
  const id = generate_id_from_entity(e);
  const m = ctx.meshes.get(id);
  if (m) {
    setTransform(m, e.transform);
  }
}

function processObjectRemoved(ctx: EventContext, obj: EntityEvent) {
  const { meshes } = ctx;
  const id = generate_id_from_entity(obj);
  const m = meshes.get(id);
  if (!m) return;

  meshes.delete(id);

  // Sprite, Mesh, and Group are all subclasses of Object3D
  if (m instanceof Object3D) {
    disposeObject3D(m);
  }

  if (m instanceof BatchedSdfTextMesh) {
    m.dispose();
  }

  // Custom event not in Object3DEventMap
  // @ts-expect-error - removedFromWorld is a custom event
  m.dispatchEvent({ type: "removedFromWorld" });

  // clear should after dispose, otherwise model's children will not be disposed
  m.clear();

  // Detach from whatever scene it was added to (mrt for opaque features,
  // transparent for always-on-top overlay sprites, globe for globe meshes).
  m.removeFromParent();
}

function disposeObject3D(model: Object3D): void {
  model.traverse((object: Object3D) => {
    if (object instanceof Mesh) {
      const mesh = object as Mesh;

      // Dispose geometry and aggressively drop all attributes
      const g = mesh.geometry;
      if (g) {
        g.dispose?.();

        // Remove every BufferAttribute (handles polyline/polygon custom attrs)
        if (g.attributes) {
          for (const key of Object.keys(g.attributes)) {
            g.deleteAttribute(key);
          }
        }

        g.index = null;
        g.boundingBox = null;
        g.boundingSphere = null;
      }

      // Dispose material(s)
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => {
            material.dispose();
          });
        } else {
          const material = mesh.material;
          material.dispose();
        }
      }
    }
    // point, billboard, text
    else if (object instanceof Sprite) {
      const sprite = object as Sprite;

      // Dispose material
      if (sprite.material) {
        if (Array.isArray(sprite.material)) {
          sprite.material.forEach((material) => {
            material.dispose();
          });
        } else {
          const material = sprite.material;
          material.dispose();
        }
      }
    }
  });
}

// TODO: Need to check if the cached texture is removed completely
async function processRequestedData(ctx: EventContext, req: DataRequestEvent) {
  const { buf, abortControllers } = ctx;
  const id = generate_id_from_entity(req);
  const priority = fetchPriorityHint(req.priority);

  const abortController = (() => {
    const a = abortControllers.get(id);
    if (a) {
      return a;
    } else {
      const a = new AbortController();
      abortControllers.set(id, a);
      return a;
    }
  })();

  if (IMAGE_EXTENSIONS.includes(req.extension)) {
    // Fetch the compressed bytes here and hand the Blob to a worker that runs
    // createImageBitmap + getImageData. Decoding the image (e.g. terrain-RGB
    // DEM tiles) entirely on the worker keeps the costly "Image Decode" off the
    // main thread — previously we decoded an HTMLImageElement and then
    // re-decoded it via createImageBitmap on the main thread.
    await fetch(req.url, { signal: abortController.signal, priority })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.blob();
      })
      .then(async (blob) => {
        if (abortController.signal.aborted) {
          return;
        }

        const promise = getImageDataFromBlob(blob);

        ctx.workerPoolPromises.set(id, promise);
        const data = await (async () => {
          try {
            return await promise;
          } finally {
            ctx.workerPoolPromises.delete(id);
          }
        })();

        if (abortController.signal.aborted) {
          return;
        }

        const u8a = new Uint8Array(data);
        buf.setU8(req.handle, req.bits, u8a);

        // Prevent memory leak
        u8a.set([]);

        data.set([]);
      })
      .catch(() => {
        buf.triggerDataRequesterFailed(req.bits);
      })
      .finally(() => {
        abortControllers.delete(id);
      });
    return;
  }

  // Quantized-mesh extensions requested for this terrain tile (empty otherwise).
  // The hyphen-joined token list is shared by the Accept header (server
  // negotiation) and the URL query (cache key) below.
  const terrainExts =
    req.extension === "terrain"
      ? [
          ...(req.requestVertexNormals ? ["octvertexnormals"] : []),
          ...(req.requestWaterMask ? ["watermask"] : []),
        ]
      : [];

  // Cesium-style quantized-mesh servers gate the normals/watermask extensions
  // behind an explicit Accept header. Only opt in when the layer requested it
  // — otherwise some servers refuse to respond, and we don't want to pay for
  // bytes we won't use anyway.
  let headers = (() => {
    if (req.extension !== "terrain") {
      return req.token ? { Authorization: `Bearer ${req.token}` } : undefined;
    }
    const accept = terrainExts.length
      ? `application/vnd.quantized-mesh;extensions=${terrainExts.join("-")},application/octet-stream;q=0.9,*/*;q=0.01`
      : "application/vnd.quantized-mesh,application/octet-stream;q=0.9,*/*;q=0.01";
    const h: Record<string, string> = { Accept: accept };
    if (req.token) h.Authorization = `Bearer ${req.token}`;
    return h;
  })();

  // Partial fetch: PMTiles (and any future range-based source) sets a byte
  // range on the request. `!= null` is intentional so a 0n offset (the header
  // bootstrap read) is still treated as present. A length of 0n (from a
  // malformed header/directory or an upstream bug) would underflow `end` to
  // `offset - 1n` and emit an invalid `Range` header — and falling back to a
  // full fetch could silently download an entire multi-GB archive — so fail
  // the request instead.
  if (req.offset != null && req.length != null) {
    if (req.length <= 0n) {
      buf.triggerDataRequesterFailed(req.bits);
      abortControllers.delete(id);
      return;
    }
    const end = req.offset + req.length - 1n;
    headers = { ...(headers ?? {}), Range: `bytes=${req.offset}-${end}` };
  }

  // Set extensions as query params to stale the cache.
  const fetchUrl = (() => {
    if (!terrainExts.length) return req.url;
    const u = new URL(req.url, globalThis.location?.href);
    u.searchParams.set("extensions", terrainExts.join("-"));
    return u.toString();
  })();

  await fetch(fetchUrl, { signal: abortController.signal, headers, priority })
    .then((res) => {
      // For range reads, require 206 so we don't silently accept a full-body 200
      // response and download an entire PMTiles archive.
      const isRangeRequest = req.offset != null && req.length != null;
      if (isRangeRequest && res.status !== 206) {
        throw new Error(
          `Range request expected 206 Partial Content, got ${res.status} ${res.statusText}`,
        );
      }

      // A successful range request returns 206 Partial Content, which is in
      // the ok range (200-299), so this guard handles both 200 and 206.
      if (!res.ok) {
        throw new Error(`Request failed with ${res.status} ${res.statusText}`);
      }
      return res.arrayBuffer();
    })
    .then((val) => {
      if (abortController.signal.aborted) {
        return;
      }

      const bytes = new Uint8Array(val);
      // MVT pbf: with the default delegated worker Rust never reads these
      // bytes — they only travel back out to `processParseMvtTile`. Adopt
      // them into the JS-side store (WASM tracks a byte-count-only `External`
      // handle) so they never round-trip through WASM linear memory. Ownership
      // moves into the store, so do NOT clear `bytes` afterward.
      // Range reads (PMTiles) also arrive with the `mvt` extension but Rust
      // parses those bytes (header/directory/payload), so they must stay
      // WASM-resident.
      const isRangeRequest = req.offset != null && req.length != null;
      if (req.extension === "mvt" && !isRangeRequest) {
        buf.setExternal(req.handle, req.bits, bytes);
      } else {
        buf.setU8(req.handle, req.bits, bytes);

        // Prevent memory leak
        bytes.set([]);
      }
    })
    .catch(() => {
      buf.triggerDataRequesterFailed(req.bits);
    })
    .finally(() => {
      abortControllers.delete(id);
    });
}

function processDataRequesterRemoved(
  ctx: EventContext,
  req: DataRequesterRemovedEvent,
) {
  const { abortControllers, workerPoolPromises, loadedTexs, hillshadeContext } =
    ctx;
  const id = generate_id_from_entity(req);
  const abortController = abortControllers.get(id);
  const workerPool = workerPoolPromises.get(id);

  // Clean up hillshade resources first (if applicable)
  // For hillshade entities, clearRenderTarget will dispose the RenderTarget and its texture
  if (hillshadeContext) {
    hillshadeContext.pendingEdges.delete(id);
    hillshadeContext.clearTempDem(id);
    hillshadeContext.clearRenderTarget(id);
  }

  // Dispose and remove texture from loadedTexs
  // For hillshade entities, texture is already disposed by clearRenderTarget above
  // Check isRenderTargetTexture to avoid double-dispose
  if (loadedTexs) {
    const texture = loadedTexs.get(id);
    if (texture && !texture.isRenderTargetTexture) {
      disposeTexture(texture);
    }
    loadedTexs.delete(id);
  }

  // Note: Do NOT call buf.remove(req.handle) here!
  // The handle is shared among multiple consumers (via Rust DataManager)
  // Rust side manages the lifecycle and will remove data when ref count reaches 0

  abortController?.abort();
  workerPool?.cancel();

  abortControllers.delete(id);
  workerPoolPromises.delete(id);
}

async function processTextureFragmentRequested(
  ctx: EventContext,
  req: TextureFragmentRequestedEvent,
) {
  const { texFragment, loadedTexs, abortControllers } = ctx;
  const id = generate_id_from_entity(req);
  if (loadedTexs.has(id)) return;

  const abortController = (() => {
    const a = abortControllers.get(id);
    if (a) {
      return a;
    } else {
      const a = new AbortController();
      abortControllers.set(id, a);
      return a;
    }
  })();

  await ABORTABLE_TEXTURE_LOADER.loadAsyncWithAbort(req.url, abortController)
    .then((t) => {
      loadedTexs.set(id, t);
      texFragment.triggerTextureFragmentLoaded(
        req.bits,
        TextureFragmentStatus.Success,
      );
    })
    .catch(() => {
      texFragment.triggerTextureFragmentLoaded(
        req.bits,
        TextureFragmentStatus.Fail,
      );
    })
    .finally(() => {
      abortControllers.delete(id);
    });
}

function processTextureFragmentRemoved(ctx: EventContext, req: EntityEvent) {
  const { loadedTexs, abortControllers, hillshadeContext } = ctx;
  const id = generate_id_from_entity(req);
  const abortController = abortControllers.get(id);

  // Clean up hillshade resources first (if applicable)
  // For hillshade entities, clearRenderTarget will dispose the RenderTarget and its texture
  if (hillshadeContext) {
    hillshadeContext.pendingEdges.delete(id);
    hillshadeContext.clearTempDem(id);
    hillshadeContext.clearRenderTarget(id);
  }

  // Dispose and remove texture from loadedTexs
  // For hillshade entities, texture is already disposed by clearRenderTarget above
  // Check isRenderTargetTexture to avoid double-dispose
  const texture = loadedTexs.get(id);
  if (texture && !texture.isRenderTargetTexture) {
    disposeTexture(texture);
  }
  loadedTexs.delete(id);

  abortController?.abort();
}

export function setTransform(
  obj: Object3D,
  transform: Transform,
  keepPosition?: boolean,
) {
  const { tx, ty, tz, qx, qy, qz, qw, sx, sy, sz } = transform;
  if (!keepPosition) {
    obj.position.set(tx, ty, tz);
  }
  obj.quaternion.set(qx, qy, qz, qw);
  obj.scale.set(sx, sy, sz);
}
