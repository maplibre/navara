import type { LatLng } from "@navaramap/core";
import {
  angleToRadian,
  sampleQuantizedMeshHeights,
  sampleRasterDemHeights,
  terrainPositionsToTiles,
  terrainTileUrl,
} from "@navaramap/engine-api";
import { workerPoolStats } from "@navaramap/worker";

import { getImageDataFromBlob } from "../tasks/getImageDataFromBlob";
import type { QuantizedMeshSource, RasterDemSource } from "../type";

/**
 * A terrain source `sampleTerrainMostDetailed` can sample: the same
 * `quantized-mesh` / `raster-dem` descriptions `addSource` accepts.
 */
export type TerrainSampleSource = QuantizedMeshSource | RasterDemSource;

export type SampleTerrainOptions = {
  /** Aborts in-flight tile fetches and rejects with the abort reason. */
  signal?: AbortSignal;
  /**
   * Sample at this fixed zoom level instead of probing down from the
   * source's `maxZoom`. A tile missing at this level yields `undefined`
   * heights rather than falling back to a coarser level (Cesium's
   * `sampleTerrain` semantics).
   */
  level?: number;
};

export type SampledTerrainPosition = {
  /** Latitude in degrees, echoed from the input. */
  lat: number;
  /** Longitude in degrees, echoed from the input. */
  lng: number;
  /**
   * Terrain height in meters, or `undefined` when no tile covering the
   * position could be fetched or decoded.
   */
  height: number | undefined;
  /** Zoom level the height was sampled at; `undefined` on failure. */
  level: number | undefined;
};

/** Same fallback as the engine (`DEFAULT_MAX_ZOOM` in `source_types.rs`). */
const DEFAULT_MAX_ZOOM = 20;
/** All-zero decoder, mirroring the engine's `ElevationDecoder::default()`. */
const DEFAULT_ELEVATION_DECODER = {
  r_scaler: 0,
  g_scaler: 0,
  b_scaler: 0,
  offset: 0,
  max_offset: 0,
  min_offset: 0,
  boundary: 0,
  epsilon: 0,
};
const MAX_CONCURRENT_TILE_FETCHES = 6;
/** Levels probed concurrently per descent step while hunting for coverage. */
const PROBE_BATCH_LEVELS = 3;
/** Retries for transient failures (5xx / network errors) per tile URL. */
const TRANSIENT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 200;

type FetchOutcome =
  | { kind: "ok"; response: Response }
  /** The server answered 404: the tile does not exist at this level. */
  | { kind: "missing" }
  /** The request kept failing (5xx / network) or was otherwise rejected. */
  | { kind: "failed" };

/** The deepest tile a probe found, with its response body still unread. */
type FoundTile = {
  x: number;
  y: number;
  level: number;
  url: string;
  response: Response;
};

type SourceConfig = {
  kind: "quantized-mesh" | "raster-dem";
  url: string;
  geographic: boolean;
  tms: boolean;
  minZoom: number;
  maxZoom: number;
  token: string | undefined;
  decoder: typeof DEFAULT_ELEVATION_DECODER;
};

/**
 * Samples terrain heights at the most detailed zoom level available from
 * `source`, fetching the needed tiles over the network — unlike the
 * synchronous `ThreeView.sampleTerrainHeight`, which only reads tiles already
 * resident for rendering and therefore returns coarse-LOD heights (or
 * nothing) when the camera is far away.
 *
 * Positions are grouped by tile, each unique tile is fetched once, and
 * heights are interpolated by the same engine code that builds the rendered
 * surface. Sampling starts at the source's `maxZoom` and falls back to
 * parent tiles on 404 until data is found (down to `minZoom`), so sources
 * whose real coverage is shallower than `maxZoom` still resolve — at the
 * cost of a few extra requests.
 *
 * Failures follow HTTP semantics: 404 means "no tile at this level" and
 * descends; 401/403 rejects the whole call (misconfigured token); 5xx and
 * network errors are retried, then yield `height: undefined` for the
 * affected positions.
 *
 * Requires the API WASM module to be initialized (`ThreeView.init()` does
 * this).
 *
 * @param source - A `quantized-mesh` or `raster-dem` source description (the
 *   same shape `addSource` accepts)
 * @param positions - Geodetic positions (lat/lng in degrees)
 * @param options - Optional abort signal and fixed-level sampling
 * @returns One result per input position, in the same order (the input
 *   objects are not mutated)
 */
export async function sampleTerrainMostDetailed(
  source: TerrainSampleSource,
  positions: LatLng[],
  options?: SampleTerrainOptions,
): Promise<SampledTerrainPosition[]> {
  if (positions.length === 0) return [];
  const config = resolveSourceConfig(source);
  const signal = options?.signal;
  throwIfAborted(signal);

  const startLevel = clampLevel(options?.level ?? config.maxZoom, config);
  // Fixed-level sampling never falls back to parents.
  const floorLevel = options?.level != null ? startLevel : config.minZoom;

  // The engine samplers work in radians; inputs and echoed outputs are degrees.
  const flat = new Float64Array(positions.length * 2);
  positions.forEach((p, i) => {
    flat[i * 2] = angleToRadian(p.lng);
    flat[i * 2 + 1] = angleToRadian(p.lat);
  });

  // Group positions by their containing tile at the starting level; each
  // group is probed once no matter how many positions share it.
  const tileXYs = terrainPositionsToTiles(config.geographic, startLevel, flat);
  const groups = new Map<string, { x: number; y: number; indices: number[] }>();
  for (let i = 0; i < positions.length; i++) {
    const x = tileXYs[i * 2];
    const y = tileXYs[i * 2 + 1];
    const key = `${x}/${y}`;
    let group = groups.get(key);
    if (!group) {
      group = { x, y, indices: [] };
      groups.set(key, group);
    }
    group.indices.push(i);
  }

  const results: SampledTerrainPosition[] = positions.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    height: undefined,
    level: undefined,
  }));

  // Distinct groups can descend onto the same parent tile; sharing outcomes
  // by URL keeps each tile fetched at most once per call.
  const outcomeCache = new Map<string, Promise<FetchOutcome>>();
  const limit = createLimiter(MAX_CONCURRENT_TILE_FETCHES);
  const groupList = [...groups.values()];
  const found = await Promise.all(
    groupList.map((group) =>
      probeMostDetailedTile(
        config,
        group,
        startLevel,
        floorLevel,
        outcomeCache,
        limit,
        signal,
      ),
    ),
  );

  // Regroup by the tile each probe found: a response body can be read only
  // once, so the groups sharing a tile are read and sampled together.
  const tiles = new Map<string, { tile: FoundTile; indices: number[] }>();
  groupList.forEach((group, i) => {
    const tile = found[i];
    if (!tile) return;
    const entry = tiles.get(tile.url);
    if (entry) entry.indices.push(...group.indices);
    else tiles.set(tile.url, { tile, indices: [...group.indices] });
  });

  await Promise.all(
    [...tiles.values()].map(async ({ tile, indices }) => {
      const tileFlat = new Float64Array(indices.length * 2);
      indices.forEach((originalIndex, i) => {
        tileFlat[i * 2] = flat[originalIndex * 2];
        tileFlat[i * 2 + 1] = flat[originalIndex * 2 + 1];
      });

      const heights = await sampleTile(config, tile, tileFlat, signal);
      if (!heights) return;
      indices.forEach((originalIndex, i) => {
        const h = heights[i];
        if (h !== undefined && Number.isFinite(h)) {
          results[originalIndex].height = h;
          results[originalIndex].level = tile.level;
        }
      });
    }),
  );

  return results;
}

function resolveSourceConfig(source: TerrainSampleSource): SourceConfig {
  const url = source.url;
  if (!url) {
    throw new TypeError("sampleTerrainMostDetailed: source.url is required");
  }
  // Defaults mirror the engine's source registration (`source_types.rs`), so
  // sampling reads the same tiles rendering would for the same description.
  if (source.type === "quantized-mesh") {
    return {
      kind: "quantized-mesh",
      url,
      geographic: source.geographic ?? true,
      tms: source.tms ?? true,
      minZoom: source.minZoom ?? 0,
      maxZoom: source.maxZoom ?? DEFAULT_MAX_ZOOM,
      token: source.token ?? undefined,
      decoder: DEFAULT_ELEVATION_DECODER,
    };
  }
  const dem = source as RasterDemSource;
  return {
    kind: "raster-dem",
    url,
    geographic: false,
    tms: dem.tms ?? false,
    minZoom: dem.minZoom ?? 0,
    maxZoom: dem.maxZoom ?? DEFAULT_MAX_ZOOM,
    token: undefined,
    decoder: { ...DEFAULT_ELEVATION_DECODER, ...dem.elevationDecoder },
  };
}

function clampLevel(level: number, config: SourceConfig): number {
  return Math.min(Math.max(Math.floor(level), config.minZoom), config.maxZoom);
}

/**
 * Walks levels from `startLevel` down to `floorLevel` looking for the
 * deepest tile the server actually has. The first probe is `startLevel`
 * alone — sources are usually fully covered at `maxZoom`, so the common case
 * costs exactly one request. Only after a 404 does each further step probe
 * {@link PROBE_BATCH_LEVELS} consecutive levels concurrently, so a source
 * whose coverage stops well short of `maxZoom` costs one round-trip per
 * batch of missing levels instead of one per level.
 */
async function probeMostDetailedTile(
  config: SourceConfig,
  group: { x: number; y: number },
  startLevel: number,
  floorLevel: number,
  outcomeCache: Map<string, Promise<FetchOutcome>>,
  limit: <T>(task: () => Promise<T>) => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<FoundTile | null> {
  let batchTop = startLevel;
  while (batchTop >= floorLevel) {
    const batchSize = batchTop === startLevel ? 1 : PROBE_BATCH_LEVELS;
    const batchBottom = Math.max(batchTop - batchSize + 1, floorLevel);
    const levels: number[] = [];
    for (let level = batchTop; level >= batchBottom; level--)
      levels.push(level);

    const outcomes = await Promise.all(
      levels.map((level) => {
        const shift = startLevel - level;
        const x = group.x >> shift;
        const y = group.y >> shift;
        const url = terrainTileUrl(
          config.url,
          config.geographic,
          config.tms,
          x,
          y,
          level,
        );
        let outcome = outcomeCache.get(url);
        if (!outcome) {
          outcome = limit(() => fetchTile(config, url, signal));
          outcomeCache.set(url, outcome);
        }
        return outcome.then((o) => ({ level, x, y, url, outcome: o }));
      }),
    );

    // Deepest success in the batch wins; a hard failure stops the descent
    // (the tile exists but is unreadable — a coarser parent would silently
    // hide the error behind a coarse height).
    for (const { level, x, y, url, outcome } of outcomes) {
      if (outcome.kind === "ok")
        return { x, y, level, url, response: outcome.response };
      if (outcome.kind === "failed") return null;
    }
    batchTop = batchBottom - 1;
  }
  return null;
}

/** Fetch one tile URL, classifying the result per HTTP semantics. */
async function fetchTile(
  config: SourceConfig,
  url: string,
  signal: AbortSignal | undefined,
): Promise<FetchOutcome> {
  const headers: Record<string, string> = {};
  if (config.kind === "quantized-mesh") {
    // Same content negotiation as the rendering fetch path, minus the
    // normals/watermask extensions — sampling only needs positions.
    headers.Accept =
      "application/vnd.quantized-mesh,application/octet-stream;q=0.9,*/*;q=0.01";
  }
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  for (let attempt = 0; ; attempt++) {
    throwIfAborted(signal);
    let response: Response;
    try {
      response = await fetch(url, { headers, signal });
    } catch (e) {
      // fetch() rejects on network errors and aborts; only retry the former.
      if (signal?.aborted) throw e;
      if (attempt < TRANSIENT_RETRIES) {
        await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      return { kind: "failed" };
    }
    if (response.ok) return { kind: "ok", response };
    // 404/410: the tile genuinely doesn't exist at this level — the caller
    // descends to the parent. Anything else is an error, not "no data".
    if (response.status === 404 || response.status === 410) {
      return { kind: "missing" };
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `sampleTerrainMostDetailed: ${response.status} ${response.statusText} for ${url} — check the source's token`,
      );
    }
    if (response.status >= 500 && attempt < TRANSIENT_RETRIES) {
      await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }
    return { kind: "failed" };
  }
}

/**
 * Decode the fetched tile and interpolate a height per position, on the same
 * engine code paths rendering uses. Returns `null` when the body cannot be
 * read or doesn't decode; `NaN` entries mean the tile had no data at that
 * position.
 */
async function sampleTile(
  config: SourceConfig,
  tile: FoundTile,
  groupFlat: Float64Array,
  signal: AbortSignal | undefined,
): Promise<Float64Array | null> {
  if (config.kind === "quantized-mesh") {
    const buffer = await readBody(tile.response.arrayBuffer(), signal);
    throwIfAborted(signal);
    if (!buffer) return null;
    const bytes = new Uint8Array(buffer);
    return (
      sampleQuantizedMeshHeights(
        bytes,
        config.geographic,
        tile.x,
        tile.y,
        tile.level,
        groupFlat,
      ) ?? null
    );
  }

  const blob = await readBody(tile.response.blob(), signal);
  throwIfAborted(signal);
  if (!blob) return null;
  const rgba = await decodeImageToRgba(blob);
  throwIfAborted(signal);
  if (!rgba) return null;
  return (
    sampleRasterDemHeights(
      rgba,
      config.decoder,
      tile.x,
      tile.y,
      tile.level,
      groupFlat,
    ) ?? null
  );
}

/**
 * Awaits a body read. A failure other than an abort (the connection lost
 * after the headers) is a network error and yields `null`.
 */
async function readBody<T>(
  read: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | null> {
  try {
    return await read;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

/**
 * Decode an image blob (PNG/WebP DEM tile) into tightly-packed RGBA bytes.
 * When a view has initialized the worker pool, the decode runs there — the
 * same off-main-thread path the rendering fetches use. Standalone callers
 * without a pool decode on the calling thread instead.
 */
async function decodeImageToRgba(blob: Blob): Promise<Uint8Array | null> {
  if (workerPoolStats()) {
    try {
      const data = await getImageDataFromBlob(blob);
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } catch {
      return null;
    }
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return new Uint8Array(image.data.buffer, 0, image.data.length);
  } finally {
    bitmap.close();
  }
}

/** Minimal promise concurrency limiter for the tile fetches. */
function createLimiter(
  maxConcurrent: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      next();
    }
  };
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
