import {
  generate_id_from_entity,
  IMAGE_EXTENSIONS,
  type JobHandler,
} from "@navaramap/core";
import type {
  DataRequestEvent,
  DataRequesterRemovedEvent,
} from "@navaramap/engine";

import { embedI3dmGltf } from "../loaders/embedI3dmGltf";
import { embedTilesetSchema } from "../loaders/embedTilesetSchema";
import { packGltf } from "../loaders/packGltf";
import { getImageDataFromBlob } from "../tasks/getImageDataFromBlob";

import type { EventContext } from "./context";
import { releaseLoadedTexture } from "./loadedTexture";
import { settleWorkerTask } from "./workerTaskSettlement";

/** Browser fetch priority hint derived from the engine rank (0 = Extreme). */
function fetchPriorityHint(rank: number): RequestPriority {
  if (rank <= 1) return "high";
  if (rank >= 3) return "low";
  return "auto";
}

/**
 * The engine reads the 3D Tiles resources a payload references by URI only
 * once they are embedded in it.
 */
const EMBED_REFERENCES: Partial<
  Record<
    string,
    (
      bytes: Uint8Array<ArrayBuffer>,
      url: string,
      init: RequestInit,
    ) => Promise<Uint8Array<ArrayBuffer>>
  >
> = {
  gltf: packGltf,
  i3dm: embedI3dmGltf,
  json: embedTilesetSchema,
};

/**
 * A data requester's product is the buffer the engine owns (reported through
 * `setU8` / `setExternal`), so the job itself has none.
 */
export const dataRequesterJobHandler = (
  ctx: EventContext,
): JobHandler<
  DataRequestEvent,
  never,
  DataRequesterRemovedEvent,
  undefined
> => ({
  name: "data requester",
  events: {
    requested: "data_requested",
    removed: "data_requester_removed",
  },
  start: (ev, abort) => processRequestedData(ctx, ev, abort),
  teardown: (_, ev) => processDataRequesterRemoved(ctx, ev),
  failed: (ev) => ctx.buf.triggerDataRequesterFailed(ev.bits, ev.handle),
});

// TODO: Need to check if the cached texture is removed completely
async function processRequestedData(
  ctx: EventContext,
  req: DataRequestEvent,
  abort: AbortController,
): Promise<undefined> {
  const { buf } = ctx;
  const { signal } = abort;
  const priority = fetchPriorityHint(req.priority);

  if (IMAGE_EXTENSIONS.includes(req.extension)) {
    // Fetch the compressed bytes here and hand the Blob to a worker that runs
    // createImageBitmap + getImageData. Decoding the image (e.g. terrain-RGB
    // DEM tiles) entirely on the worker keeps the costly "Image Decode" off the
    // main thread — previously we decoded an HTMLImageElement and then
    // re-decoded it via createImageBitmap on the main thread.
    const res = await fetch(req.url, { signal, priority });
    if (!res.ok) throw new Error(`Request failed with ${res.status}`);
    const blob = await res.blob();
    if (signal.aborted) return;

    const settled = await settleWorkerTask(signal, getImageDataFromBlob(blob));
    if (settled.status === "cancelled") return;
    if (settled.status === "failed") throw settled.error;
    if (signal.aborted) return;

    const data = settled.value;
    const u8a = new Uint8Array(data);
    buf.setU8(req.handle, req.bits, u8a);

    // Prevent memory leak
    u8a.set([]);
    data.set([]);
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
  const { offset, length } = req;
  const isRangeRequest = offset != null && length != null;
  if (isRangeRequest) {
    if (length <= 0n) {
      throw new Error("Range request with a non-positive length");
    }
    const end = offset + length - 1n;
    headers = { ...(headers ?? {}), Range: `bytes=${offset}-${end}` };
  }

  // Set extensions as query params to stale the cache.
  const fetchUrl = (() => {
    if (!terrainExts.length) return req.url;
    const u = new URL(req.url, globalThis.location?.href);
    u.searchParams.set("extensions", terrainExts.join("-"));
    return u.toString();
  })();

  const res = await fetch(fetchUrl, { signal, headers, priority });
  // For range reads, require 206 so we don't silently accept a full-body 200
  // response and download an entire PMTiles archive.
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
  const val = await res.arrayBuffer();
  if (signal.aborted) return;

  let bytes = new Uint8Array(val);
  const embed = EMBED_REFERENCES[req.extension];
  if (embed) {
    bytes = await embed(bytes, req.url, { signal, headers, priority });
    if (signal.aborted) return;
  }
  // MVT pbf: with the default delegated worker Rust never reads these
  // bytes — they only travel back out to `processParseMvtTile`. Adopt
  // them into the JS-side store (WASM tracks a byte-count-only `External`
  // handle) so they never round-trip through WASM linear memory. Ownership
  // moves into the store, so do NOT clear `bytes` afterward.
  // Range reads (PMTiles) also arrive with the `mvt` extension but Rust
  // parses those bytes (header/directory/payload), so they must stay
  // WASM-resident.
  if (req.extension === "mvt" && !isRangeRequest) {
    buf.setExternal(req.handle, req.bits, bytes);
  } else {
    buf.setU8(req.handle, req.bits, bytes);

    // Prevent memory leak
    bytes.set([]);
  }
}

function processDataRequesterRemoved(
  ctx: EventContext,
  req: DataRequesterRemovedEvent | undefined,
) {
  if (!req) return;
  releaseLoadedTexture(ctx, generate_id_from_entity(req));

  // Note: Do NOT call buf.remove(req.handle) here!
  // The handle is shared among multiple consumers (via Rust DataManager)
  // Rust side manages the lifecycle and will remove data when ref count reaches 0
}
