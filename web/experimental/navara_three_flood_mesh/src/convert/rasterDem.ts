/**
 * Samples a `raster-dem` source, in Node, where `@navaramap/three` does not
 * run, and in a browser: with the engine's own tile addressing and height
 * interpolation, as its `sampleTerrainMostDetailed` does. The terrain the
 * command samples and the geoid the converters read go through it.
 */
import type * as Fs from "node:fs";
import type * as NodeModule from "node:module";

import init, {
  ElevationDecoder as EngineElevationDecoder,
  initSync,
  sampleRasterDemHeights,
  terrainPositionsToTiles,
  terrainTileUrl,
} from "@navaramap/engine-api";
import type Sharp from "sharp";

import type {
  ElevationDecoder,
  ElevationDecoderName,
  RasterDemTerrain,
  Terrain,
  TerrainPosition,
  TerrainSampler,
} from "./terrain";

/** Same as `sampleTerrainMostDetailed`'s. */
const DEFAULT_MAX_ZOOM = 20;
const MAX_CONCURRENT_TILE_FETCHES = 6;

// Node modules and optional peer dependencies, loaded only in Node; their
// specifiers are hidden from bundlers.
const importHidden = <T>(specifier: string) =>
  import(/* @vite-ignore */ specifier) as Promise<T>;

const isNode = () =>
  typeof process !== "undefined" && process.versions?.node !== undefined;

let initializing: Promise<void> | undefined;

// The module's own init fetches the WASM by URL, which Node cannot; there it
// is read from the file. A browser shares the instance `ThreeView` inits.
const initApi = () =>
  (initializing ??= (async () => {
    if (!isNode()) {
      await init();
      return;
    }
    const [{ readFileSync }, { createRequire }] = await Promise.all([
      importHidden<typeof Fs>("node:fs"),
      importHidden<typeof NodeModule>("node:module"),
    ]);
    const path = createRequire(import.meta.url).resolve(
      "@navaramap/engine-api/navara_wasm_api_bg.wasm",
    );
    initSync({ module: readFileSync(path) });
  })());

let sharpLoading: Promise<typeof Sharp> | undefined;

// An optional peer dependency, needed only to read tiles in Node; a browser
// decodes them itself.
function loadSharp(): Promise<typeof Sharp> {
  sharpLoading ??= importHidden<{ default: typeof Sharp }>("sharp").then(
    (module) => module.default,
    (error: unknown) => {
      sharpLoading = undefined;
      throw new Error(
        `Reading height tiles needs the sharp package; install it. (${String(error)})`,
      );
    },
  );
  return sharpLoading;
}

/** The RGBA pixels of an encoded tile, row-major. */
const rgbaOf = async (response: Response): Promise<Uint8Array> => {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(
      new Blob([bytes as BlobPart], {
        type: response.headers.get("content-type") ?? "",
      }),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot draw the height tile.");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return new Uint8Array(data.buffer);
  }
  const sharp = await loadSharp();
  return sharp(bytes).ensureAlpha().raw().toBuffer();
};

/** `decoder`, or the engine's it names, as the plain object it samples by. */
const decoderOf = (
  decoder: ElevationDecoder | ElevationDecoderName,
): ElevationDecoder => {
  if (typeof decoder !== "string") return decoder;
  const factories = EngineElevationDecoder as unknown as Record<
    string,
    unknown
  >;
  const names = Object.getOwnPropertyNames(EngineElevationDecoder).filter(
    (name) => !name.startsWith("__") && typeof factories[name] === "function",
  );
  if (!names.includes(decoder)) {
    throw new Error(
      `elevationDecoder "${decoder}" is none of ${names.map((name) => `"${name}"`).join(", ")}.`,
    );
  }
  const engine = EngineElevationDecoder[decoder]();
  const {
    r_scaler,
    g_scaler,
    b_scaler,
    offset,
    max_offset,
    min_offset,
    boundary,
    epsilon,
  } = engine;
  engine.free();
  return {
    r_scaler,
    g_scaler,
    b_scaler,
    offset,
    max_offset,
    min_offset,
    boundary,
    epsilon,
  };
};

/** `terrain` as a `TerrainSampler`, refusing a malformed source. */
export const terrainSamplerOf = (terrain: Terrain): TerrainSampler => {
  if (typeof terrain === "function") return terrain;
  if (terrain.type !== "raster-dem" || typeof terrain.url !== "string") {
    throw new Error(
      'terrain must be a "raster-dem" source with its url, or a TerrainSampler.',
    );
  }
  if (!terrain.elevationDecoder) {
    throw new Error("A raster-dem terrain needs its elevationDecoder.");
  }
  return (positions) => sampleRasterDemMostDetailed(terrain, positions);
};

/**
 * Samples `source` at the most detailed zoom it has, as
 * `sampleTerrainMostDetailed` of `@navaramap/three` does: from `maxZoom`, a
 * tile the server does not have (404) falls back to its parents down to
 * `minZoom`.
 */
export const sampleRasterDemMostDetailed = async (
  {
    url,
    elevationDecoder,
    minZoom = 0,
    maxZoom = DEFAULT_MAX_ZOOM,
    tms = false,
  }: RasterDemTerrain,
  positions: TerrainPosition[],
): Promise<{ height: number | undefined }[]> => {
  await initApi();
  const decoder = decoderOf(elevationDecoder);
  const results = positions.map(() => ({
    height: undefined as number | undefined,
  }));
  // The engine works in radians.
  const flat = new Float64Array(positions.length * 2);
  positions.forEach(({ lng, lat }, i) => {
    flat[i * 2] = (lng * Math.PI) / 180;
    flat[i * 2 + 1] = (lat * Math.PI) / 180;
  });

  // Each tile fetched once, its parents only where it is missing.
  const tiles = new Map<string, Promise<Uint8Array | null>>();
  let active = 0;
  const waiting: (() => void)[] = [];
  const fetchTile = (address: string) => {
    let tile = tiles.get(address);
    if (!tile) {
      tile = (async () => {
        if (active >= MAX_CONCURRENT_TILE_FETCHES) {
          await new Promise<void>((resolve) => waiting.push(resolve));
        }
        active++;
        try {
          const response = await fetch(address);
          if (response.status === 404 || response.status === 410) return null;
          if (!response.ok) throw new Error(`${address}: ${response.status}`);
          return await rgbaOf(response);
        } finally {
          active--;
          waiting.shift()?.();
        }
      })();
      tiles.set(address, tile);
    }
    return tile;
  };

  const tileXYs = terrainPositionsToTiles(false, maxZoom, flat);
  const groups = new Map<string, { x: number; y: number; indices: number[] }>();
  for (let i = 0; i < positions.length; i++) {
    const x = tileXYs[i * 2];
    const y = tileXYs[i * 2 + 1];
    const key = `${x}/${y}`;
    const group = groups.get(key);
    if (group) group.indices.push(i);
    else groups.set(key, { x, y, indices: [i] });
  }
  await Promise.all(
    [...groups.values()].map(async ({ x, y, indices }) => {
      const groupFlat = new Float64Array(indices.length * 2);
      indices.forEach((i, k) =>
        groupFlat.set(flat.subarray(i * 2, i * 2 + 2), k * 2),
      );
      for (let level = maxZoom; level >= minZoom; level--) {
        const shift = maxZoom - level;
        const tx = x >> shift;
        const ty = y >> shift;
        const rgba = await fetchTile(
          terrainTileUrl(url, false, tms, tx, ty, level),
        );
        if (!rgba) continue;
        const heights = sampleRasterDemHeights(
          rgba,
          decoder,
          tx,
          ty,
          level,
          groupFlat,
        );
        indices.forEach((i, k) => {
          const height = heights?.[k];
          if (height !== undefined && Number.isFinite(height)) {
            results[i].height = height;
          }
        });
        return;
      }
    }),
  );
  return results;
};
