import { DataUtils } from "three";
import type * as Zarr from "zarrita";
import type { Readable } from "zarrita";

import {
  dilate,
  extendValues,
  fillNearestValues,
  nodeNeighbors,
  signedDistance,
} from "./derive";
import { HALF_NAN, layerSize } from "./layout";
import { rangeFromAttributes, rangeOf, type ValueRange } from "./stats";
import { parseUtc } from "./utc";

/**
 * Lazily loaded zarrita, so registering the descriptor costs nothing until a
 * series is loaded; its compressors load on demand in turn.
 */
type ZarrModule = typeof Zarr;
let zarrLoading: Promise<ZarrModule> | undefined;

function loadZarr(): Promise<ZarrModule> {
  zarrLoading ??= import("zarrita").catch((error: unknown) => {
    // Allow a later retry (e.g. a transient network failure).
    zarrLoading = undefined;
    throw error;
  });
  return zarrLoading;
}

/** Names of the Zarr arrays a water-surface series is read from. */
export type TimeSeriesFloodVariables = {
  /**
   * `[time, lat, lng]` water-surface height in meters above the WGS84
   * ellipsoid. A cell is dry where the value is NaN or the array's fill
   * value. CF `scale_factor` and `add_offset` attributes are applied.
   */
  waterLevel?: string;
  /** 1D time coordinate with CF `units` such as `"seconds since 1970-01-01"`. */
  time?: string;
  /** 1D, evenly spaced latitude of the cell centers in degrees. */
  lat?: string;
  /** 1D, evenly spaced longitude of the cell centers in degrees. */
  lng?: string;
  /**
   * Optional `[time, lat, lng]` signed distance in meters to each frame's
   * shoreline, negative where wet. Named by the group's `signed_distance`
   * attribute when absent; computed on load without either.
   */
  signedDistance?: string;
  /**
   * Arrays of the properties to load, `[time, lat, lng]` or `[lat, lng]`,
   * each with CF `scale_factor` and `add_offset` applied. The group's
   * `properties` attribute lists them when absent.
   */
  properties?: string[];
  /**
   * The property holding the ground height above the WGS84 ellipsoid, which
   * the `depth` property is derived from. Named by the group's `ground`
   * attribute when absent.
   */
  ground?: string;
  /**
   * The arrays of the flow velocity in m/s, eastward and northward, each
   * `[time, lat, lng]` or `[lat, lng]`. The surface's waves drift with it, and
   * the `speed` property is derived from it. Named by the group's `flow`
   * attribute when absent.
   */
  flow?: [east: string, north: string];
};

type CommonOptions = {
  variables?: TimeSeriesFloodVariables;
  /** Aborts the loading, which then rejects with the signal's reason. */
  signal?: AbortSignal;
  /**
   * Called as the loading advances with a rough share of the work done, from
   * 0 up to 1.
   */
  onProgress?: (fraction: number) => void;
};

export type TimeSeriesFloodSeriesOptions = CommonOptions &
  (
    | {
        /** URL of the Zarr group; a relative URL resolves against the page. */
        url: string | URL;
        /**
         * Sends each request instead of `fetch`, such as to add a header or
         * sign the URL: given a `Request`, it resolves to the `Response`, and a
         * 404 reads as a missing chunk.
         */
        fetch?: (request: Request) => Promise<Response>;
        store?: never;
      }
    | {
        /**
         * The zarrita store holding the group at its root instead of `url`,
         * such as the `Map` a converter wrote.
         */
        store: Readable;
        url?: never;
        fetch?: never;
      }
  );

/** A property the surface can be colored by: its range and description. */
export type TimeSeriesFloodProperty = ValueRange & {
  /** Its unit, from the array's CF `units` attribute, such as `"m/s"`. */
  units?: string;
  /** Its description, from the array's CF `long_name` attribute. */
  label?: string;
};

/** An area in degrees. */
export type TimeSeriesFloodBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * @internal A property's values at the nodes as half floats above `min`,
 * NaN where missing, laid out as the texture is: layers of
 * `layerSize(nodes.length)` texels, node `n` of layer `k` at `k * layer + n`.
 * A property that changes over time has a layer per frame and one more, its
 * maximum over the frames.
 */
export type TimeSeriesFloodField = {
  data: Uint16Array;
  /** 1 for a property that does not change over time. */
  frames: number;
  /**
   * Whether frame `k` holds the value over the interval to frame `k + 1`,
   * such as a rate, which holds until the next frame rather than blending
   * into it.
   */
  stepwise: boolean;
  min: number;
  max: number;
};

/** A loaded water-surface series, ready for {@link TimeSeriesFloodMeshDesc}. */
export type TimeSeriesFloodSeries = {
  /** Time of each frame. */
  readonly times: readonly Date[];
  /** Number of cells that turn wet or dry between frame `k` and `k + 1`. */
  readonly changes: readonly number[];
  /** The area of the cells the water reaches in any frame. */
  readonly bounds: TimeSeriesFloodBounds;
  /**
   * The properties the surface can be colored by: those stored with the
   * series, and, derived from it, `depth` (meters, with a ground height),
   * `speed` (m/s, with a flow), `arrival` and `duration` (hours since the
   * first frame and hours wet) and `rate` (meters per hour the level changes
   * by).
   */
  readonly properties: Readonly<Record<string, TimeSeriesFloodProperty>>;
  /** @internal */
  readonly grid: TimeSeriesFloodGrid;
  /** @internal Cell index `y * grid.width + x` of each node, ascending. */
  readonly nodes: Uint32Array;
  /** @internal Each node's offset of its stored heights. */
  readonly heightBases: Float32Array;
  /**
   * @internal Half floats, two per texel: height above the node's
   * `heightBases` entry and
   * signed distance, laid out as the texture is (see
   * {@link TimeSeriesFloodField}), a layer per frame and a last one with
   * each node's highest level and its least distance over the frames.
   */
  readonly texels: Uint16Array;
  /**
   * @internal Half floats, two per texel: the flow eastward and northward in
   * m/s, laid out as {@link texels}, with each node's fastest flow in the last
   * layer. Absent without a flow.
   */
  readonly flow?: Uint16Array;
  /** @internal The properties' values. */
  readonly fields: ReadonlyMap<string, TimeSeriesFloodField>;
};

/** @internal The cells around the water, a window of the source grid. */
export type TimeSeriesFloodGrid = {
  width: number;
  height: number;
  /** Center of cell `(0, 0)` in degrees. */
  lng0: number;
  lat0: number;
  /** Cell spacing in degrees, negative for a descending axis. */
  lngStep: number;
  latStep: number;
};

const DEFAULT_VARIABLES: Required<
  Omit<
    TimeSeriesFloodVariables,
    "signedDistance" | "properties" | "ground" | "flow"
  >
> = {
  waterLevel: "water_level",
  time: "time",
  lat: "lat",
  lng: "lon",
};

const UNIT_MS: Record<string, number> = {
  milliseconds: 1,
  millisecond: 1,
  ms: 1,
  seconds: 1000,
  second: 1000,
  s: 1000,
  minutes: 60_000,
  minute: 60_000,
  min: 60_000,
  hours: 3_600_000,
  hour: 3_600_000,
  h: 3_600_000,
  days: 86_400_000,
  day: 86_400_000,
  d: 86_400_000,
};

/** @internal Decodes CF time values such as `"hours since 2024-10-20 21:00"`. */
export function decodeTimes(values: ArrayLike<number>, units: unknown): Date[] {
  const match =
    typeof units === "string" ? /^\s*(\w+)\s+since\s+(.+)$/.exec(units) : null;
  const scale = match ? UNIT_MS[match[1].toLowerCase()] : undefined;
  if (!match || scale === undefined) {
    throw new Error(`Unsupported time units: ${String(units)}`);
  }
  // CF reference times without a zone are UTC.
  const origin = parseUtc(match[2]);
  if (Number.isNaN(origin)) {
    throw new Error(`Unsupported time units: ${String(units)}`);
  }
  for (let k = 1; k < values.length; k++) {
    if (!(values[k] > values[k - 1])) {
      throw new Error("The frame times must increase.");
    }
  }
  return Array.from(values, (v) => new Date(origin + v * scale));
}

/**
 * @internal Start and step of an evenly spaced axis. `precision` is the
 * rounding error of the stored values relative to their magnitude.
 */
export function regularAxis(
  values: ArrayLike<number>,
  precision = 0,
): {
  start: number;
  step: number;
} {
  const n = values.length;
  const step = n > 1 ? (values[n - 1] - values[0]) / (n - 1) : 0;
  let magnitude = 0;
  for (let i = 0; i < n; i++)
    magnitude = Math.max(magnitude, Math.abs(values[i]));
  // The reconstructed value and the stored one are each rounded once.
  const tolerance = Math.abs(step) * 1e-3 + 2 * precision * magnitude;
  for (let i = 0; i < n; i++) {
    if (Math.abs(values[0] + i * step - values[i]) > tolerance) {
      throw new Error("Coordinates must be evenly spaced");
    }
  }
  return { start: values[0], step };
}

// Relative rounding error of a stored float: half its machine epsilon.
const ROUNDING: Partial<Record<string, number>> = {
  float16: 2 ** -11,
  float32: 2 ** -24,
};

const toNumbers = (data: unknown): Float64Array => {
  if (data instanceof BigInt64Array || data instanceof BigUint64Array) {
    return Float64Array.from(data, Number);
  }
  return Float64Array.from(data as ArrayLike<number>);
};

/**
 * Loads a water-surface time series from a Zarr group: water-surface
 * heights on a regular latitude/longitude grid over time, with the
 * properties stored alongside.
 */
export async function loadTimeSeriesFlood(
  options: TimeSeriesFloodSeriesOptions,
): Promise<TimeSeriesFloodSeries> {
  const { variables = {}, signal, onProgress } = options;
  signal?.throwIfAborted();
  const zarr = await loadZarr();
  const names = { ...DEFAULT_VARIABLES, ...variables };
  const reads = trackMisses(
    options.store
      ? options.store
      : new zarr.FetchStore(new URL(options.url, globalThis.location?.href), {
          fetch: options.fetch,
        }),
    signal,
  );
  const root = zarr.root(reads.store);
  // Tries v3 first: zarrita's default probes v2 metadata first, which costs
  // two failed requests per array on a v3 store.
  const open = (name: string) =>
    zarr.open
      .v3(root.resolve(name), { kind: "array" })
      .catch(() => zarr.open.v2(root.resolve(name), { kind: "array" }));
  // The group's attributes name the optional arrays; a group without
  // metadata (or one that fails to open) has none.
  const groupAttrs = await zarr.open
    .v3(root, { kind: "group" })
    .catch(() => zarr.open.v2(root, { kind: "group" }))
    .then((group) => group.attrs)
    .catch(() => ({}) as Record<string, unknown>);
  const distanceName =
    variables.signedDistance ??
    (typeof groupAttrs.signed_distance === "string"
      ? groupAttrs.signed_distance
      : undefined);
  const groundName =
    variables.ground ??
    (typeof groupAttrs.ground === "string" ? groupAttrs.ground : undefined);
  const flowNames = variables.flow ?? flowOf(groupAttrs.flow);
  // The ground height is read for the depth and the flow for the waves, and
  // shown only when asked for.
  const propertyNames =
    variables.properties ??
    (Array.isArray(groupAttrs.properties)
      ? groupAttrs.properties.filter(
          (n): n is string =>
            typeof n === "string" &&
            n !== groundName &&
            !flowNames?.includes(n),
        )
      : []);

  const [timeArray, latArray, lngArray, levelArray, distanceArray] =
    await Promise.all([
      open(names.time),
      open(names.lat),
      open(names.lng),
      open(names.waterLevel),
      distanceName ? open(distanceName) : undefined,
    ]);
  const readNames = [
    ...new Set([
      ...propertyNames,
      ...(groundName ? [groundName] : []),
      ...(flowNames ?? []),
    ]),
  ];
  const propertyArrays = await Promise.all(
    readNames.map(async (name) => [name, await open(name)] as const),
  );

  const times = decodeTimes(
    toNumbers((await zarr.get(timeArray, null, { signal })).data),
    timeArray.attrs.units,
  );
  const lat = regularAxis(
    toNumbers((await zarr.get(latArray, null, { signal })).data),
    ROUNDING[latArray.dtype],
  );
  const lng = regularAxis(
    toNumbers((await zarr.get(lngArray, null, { signal })).data),
    ROUNDING[lngArray.dtype],
  );
  const [frameCount, rows, cols] = levelArray.shape;
  if (
    frameCount !== times.length ||
    rows !== latArray.shape[0] ||
    cols !== lngArray.shape[0]
  ) {
    throw new Error(
      `${names.waterLevel} must be shaped [${names.time}, ${names.lat}, ${names.lng}]`,
    );
  }
  if (distanceArray && distanceArray.shape.join() !== levelArray.shape.join()) {
    throw new Error(
      `${distanceName} must be shaped [${names.time}, ${names.lat}, ${names.lng}]`,
    );
  }
  for (const [name, array] of propertyArrays) {
    const shape = array.shape;
    const timed = shape.length === 3;
    if (
      (shape.length !== 2 && !timed) ||
      (timed && shape[0] !== frameCount) ||
      shape[shape.length - 2] !== rows ||
      shape[shape.length - 1] !== cols
    ) {
      throw new Error(
        `${name} must be shaped [${names.time}, ${names.lat}, ${names.lng}] or [${names.lat}, ${names.lng}]`,
      );
    }
  }

  const { scale, offset, missing } = decoding(levelArray);
  const isDry = missing.length
    ? missing.length === 1
      ? (v: number) => v !== v || v === missing[0]
      : (v: number) => v !== v || missing.includes(v)
    : (v: number) => v !== v;

  // The share of the work each stage takes, roughly: reading the water
  // level, the distance to the shoreline, then the properties.
  const progress = new Progress(onProgress, [
    LEVEL_WORK,
    distanceArray ? STORED_DISTANCE_WORK : COMPUTED_DISTANCE_WORK,
    readNames.length ? PROPERTY_WORK : 0,
  ]);

  // Cells wet in any frame, with their whole series, read tile by tile.
  const [, tileRows, tileCols] = levelArray.chunks;
  const wetCells: number[] = [];
  let wetSeries = new Float32Array(1024 * frameCount);
  const tiles: [number, number][] = [];
  for (let ty = 0; ty * tileRows < rows; ty++) {
    for (let tx = 0; tx * tileCols < cols; tx++) tiles.push([ty, tx]);
  }
  const cell = new Float32Array(frameCount);
  let tilesRead = 0;
  await mapLimit(tiles, FETCH_CONCURRENCY, async ([ty, tx]) => {
    const tile = await readTile(levelArray, ty, tx, reads);
    progress.report(0, ++tilesRead / tiles.length);
    if (tile.chunks.every((c) => !c.data)) return;
    const y0 = ty * tileRows;
    const x0 = tx * tileCols;
    const tileHeight = Math.min(tileRows, rows - y0);
    const tileWidth = Math.min(tileCols, cols - x0);
    for (let y = 0; y < tileHeight; y++) {
      for (let x = 0; x < tileWidth; x++) {
        let any = false;
        for (let c = 0; c < tile.chunks.length; c++) {
          const { data, stride } = tile.chunks[c];
          const k0 = c * tile.timeChunk;
          const count = Math.min(tile.timeChunk, frameCount - k0);
          if (!data) {
            cell.fill(NaN, k0, k0 + count);
            continue;
          }
          const base = y * stride[1] + x * stride[2];
          for (let kk = 0; kk < count; kk++) {
            const v = data[base + kk * stride[0]];
            if (isDry(v)) {
              cell[k0 + kk] = NaN;
            } else {
              cell[k0 + kk] = v * scale + offset;
              any = true;
            }
          }
        }
        if (!any) continue;
        if ((wetCells.length + 1) * frameCount > wetSeries.length) {
          const grown = new Float32Array(wetSeries.length * 2);
          grown.set(wetSeries);
          wetSeries = grown;
        }
        wetSeries.set(cell, wetCells.length * frameCount);
        wetCells.push((y0 + y) * cols + x0 + x);
      }
    }
  });
  if (!wetCells.length)
    throw new Error(`${names.waterLevel} is dry everywhere`);

  // A window around the wet cells with a one-cell margin, so the shoreline
  // can be drawn up to the cell edge.
  let wetMinX = Infinity;
  let wetMinY = Infinity;
  let wetMaxX = -Infinity;
  let wetMaxY = -Infinity;
  for (const c of wetCells) {
    const x = c % cols;
    const y = (c - x) / cols;
    wetMinX = Math.min(wetMinX, x);
    wetMaxX = Math.max(wetMaxX, x);
    wetMinY = Math.min(wetMinY, y);
    wetMaxY = Math.max(wetMaxY, y);
  }
  const minX = Math.max(wetMinX - 1, 0);
  const minY = Math.max(wetMinY - 1, 0);
  const width = Math.min(wetMaxX + 1, cols - 1) - minX + 1;
  const height = Math.min(wetMaxY + 1, rows - 1) - minY + 1;

  // The nodes: the wet cells and their neighbors, as a graph.
  const everWet = new Uint8Array(width * height);
  for (const c of wetCells) {
    const x = c % cols;
    everWet[((c - x) / cols - minY) * width + (x - minX)] = 1;
  }
  const domain = dilate(everWet, width, height);
  let nodeCount = 0;
  for (const inside of domain) if (inside) nodeCount++;
  const nodes = new Uint32Array(nodeCount);
  const nodeAt = new Int32Array(width * height).fill(-1);
  for (let i = 0, n = 0; i < domain.length; i++) {
    if (!domain[i]) continue;
    nodeAt[i] = n;
    nodes[n++] = i;
  }
  const neighbors = nodeNeighbors(nodes, nodeAt, width, height);
  const count = nodes.length;
  const layer = layerSize(count);

  // Read while the heights are processed.
  const readingDistance = distanceArray
    ? readAtNodes(distanceArray, nodes, width, minX, minY, frameCount, reads)
    : undefined;

  // The heights at the nodes, frame-major, with the wet nodes flagged, and
  // each node's highest level while wet.
  const heights = new Float32Array(count * frameCount).fill(NaN);
  const wet = new Uint8Array(count * frameCount);
  const highest = new Float32Array(count).fill(-Infinity);
  for (let w = 0; w < wetCells.length; w++) {
    const c = wetCells[w];
    const x = c % cols;
    const n = nodeAt[((c - x) / cols - minY) * width + (x - minX)];
    for (let k = 0; k < frameCount; k++) {
      const v = wetSeries[w * frameCount + k];
      if (v !== v) continue;
      heights[k * count + n] = v;
      wet[k * count + n] = 1;
      if (v > highest[n]) highest[n] = v;
    }
  }
  wetSeries = new Float32Array(0);

  // Per frame: extend the heights past the shoreline and count the cells
  // that changed.
  const changes: number[] = [];
  for (let k = 0; k < frameCount; k++) {
    extendValues(heights.subarray(k * count, (k + 1) * count), neighbors);
    if (k === 0) continue;
    let changed = 0;
    for (let n = 0; n < count; n++) {
      if (wet[k * count + n] !== wet[(k - 1) * count + n]) changed++;
    }
    changes.push(changed);
  }
  fillAcrossFrames(heights, count, frameCount);
  // Past the cells ever wet, the highest level extends like a frame's.
  for (let n = 0; n < count; n++) {
    if (highest[n] === -Infinity) highest[n] = NaN;
  }
  extendValues(highest, neighbors);
  // Each node's heights are stored above its lowest, so the half floats keep
  // their precision over a flood spanning a wide range of elevations.
  const heightBases = new Float32Array(count);
  for (let n = 0; n < count; n++) {
    let base = Infinity;
    for (let k = 0; k <= frameCount; k++) {
      const h = k < frameCount ? heights[k * count + n] : highest[n];
      // NaN fails the comparison.
      if (h < base) base = h;
    }
    heightBases[n] = Number.isFinite(base) ? base : 0;
  }

  // The signed distance to the shoreline: as stored when it covers every
  // node, else measured on the grid frame by frame.
  const latMid = lat.start + (minY + height / 2) * lat.step;
  const dx = 111_320 * Math.cos((latMid * Math.PI) / 180) * Math.abs(lng.step);
  const dy = 110_950 * Math.abs(lat.step);
  const stored = await readingDistance;
  const distances = stored?.complete ? stored.values : undefined;
  const texels = new Uint16Array(layer * (frameCount + 1) * 2);
  const wetGrid = new Uint8Array(distances ? 0 : width * height);
  const least = new Float32Array(count).fill(Infinity);
  const setTexel = (k: number, n: number, h: number, distance: number) => {
    const t = (k * layer + n) * 2;
    texels[t] = DataUtils.toHalfFloat(h - heightBases[n]);
    // A frame with no wet (or no dry) cell measures ~1e10 everywhere; keep
    // the distance in half-float range, where only its sign and nearby
    // values matter.
    texels[t + 1] = DataUtils.toHalfFloat(
      Math.max(-HALF_FLOAT_MAX, Math.min(HALF_FLOAT_MAX, distance)),
    );
  };
  for (let k = 0; k < frameCount; k++) {
    signal?.throwIfAborted();
    let distance: Float32Array;
    if (distances) {
      distance = distances.subarray(k * count, (k + 1) * count);
    } else {
      wetGrid.fill(0);
      for (let n = 0; n < count; n++) wetGrid[nodes[n]] = wet[k * count + n];
      const onGrid = signedDistance(wetGrid, width, height, dx, dy);
      distance = new Float32Array(count);
      for (let n = 0; n < count; n++) distance[n] = onGrid[nodes[n]];
    }
    for (let n = 0; n < count; n++) {
      setTexel(k, n, heights[k * count + n], distance[n]);
      if (distance[n] < least[n]) least[n] = distance[n];
    }
    progress.report(1, (k + 1) / frameCount);
  }
  // The union of the frames' water is within each one's distance, so the
  // least of them is the distance to its shoreline outside and close to it
  // inside.
  for (let n = 0; n < count; n++) {
    setTexel(frameCount, n, highest[n], least[n]);
  }

  // The properties: stored ones, then the derived ones, each continued past
  // the shoreline so the surface never shows a gap.
  const fields = new Map<string, TimeSeriesFloodField>();
  const properties: Record<string, TimeSeriesFloodProperty> = {};
  const addField = (
    name: string,
    values: Float32Array,
    frames: number,
    description: Omit<TimeSeriesFloodProperty, keyof ValueRange>,
    stored?: ValueRange,
    stepwise = false,
  ) => {
    const range = stored ?? rangeOf(values);
    if (!Number.isFinite(range.min)) return;
    // The maximum over the frames, before the missing values are filled.
    let maximum: Float32Array | undefined;
    if (frames > 1) {
      maximum = new Float32Array(count).fill(NaN);
      for (let k = 0; k < frames; k++) {
        for (let n = 0; n < count; n++) {
          const v = values[k * count + n];
          if (v === v && !(v <= maximum[n])) maximum[n] = v;
        }
      }
      fillNearestValues(maximum, neighbors);
    }
    for (let k = 0; k < frames; k++) {
      fillNearestValues(values.subarray(k * count, (k + 1) * count), neighbors);
    }
    fillAcrossFrames(values, count, frames);
    const sources = Array.from({ length: frames }, (_, k) =>
      values.subarray(k * count),
    );
    if (maximum) sources.push(maximum);
    const data = new Uint16Array(layer * sources.length);
    for (const [k, source] of sources.entries()) {
      for (let n = 0; n < count; n++) {
        const v = source[n];
        data[k * layer + n] =
          v !== v ? HALF_NAN : DataUtils.toHalfFloat(v - range.min);
      }
    }
    properties[name] = { ...range, ...description };
    fields.set(name, {
      data,
      frames,
      stepwise,
      min: range.min,
      max: range.max,
    });
  };
  let ground: Float32Array | undefined;
  let groundFrames = 1;
  const flowValues = new Map<string, Float32Array>();
  let propertiesRead = 0;
  for (const [name, array] of propertyArrays) {
    const frames = array.shape.length === 3 ? frameCount : 1;
    const { values } = await readAtNodes(
      array,
      nodes,
      width,
      minX,
      minY,
      frames,
      reads,
    );
    if (name === groundName) {
      ground = values.slice();
      groundFrames = frames;
    }
    if (flowNames?.includes(name)) {
      const timed = new Float32Array(count * frameCount);
      for (let k = 0; k < frameCount; k++) {
        timed.set(
          frames === 1 ? values : values.subarray(k * count, (k + 1) * count),
          k * count,
        );
      }
      flowValues.set(name, timed);
    }
    if (propertyNames.includes(name)) {
      addField(
        name,
        values,
        frames,
        describe(array.attrs),
        rangeFromAttributes(array.attrs),
      );
    }
    progress.report(2, ++propertiesRead / propertyArrays.length);
  }

  const hoursOf = (k: number) =>
    (times[k].getTime() - times[0].getTime()) / 3_600_000;
  if (ground && !fields.has("depth")) {
    // Only where wet: the extended heights mean nothing over dry ground.
    const depth = new Float32Array(heights.length);
    for (let k = 0; k < frameCount; k++) {
      for (let n = 0; n < count; n++) {
        const t = k * count + n;
        const g = ground[groundFrames === 1 ? n : t];
        depth[t] = wet[t] ? Math.max(heights[t] - g, 0) : NaN;
      }
    }
    addField("depth", depth, frameCount, { units: "m", label: "Depth" });
  }
  let flow: Uint16Array | undefined;
  if (flowNames) {
    const [east, north] = flowNames.map((name) => {
      const values = flowValues.get(name);
      if (!values) throw new Error(`${name} was not read`);
      return values;
    });
    // Only where wet, as a model may hold anything over dry ground, and where
    // both components are known, as one alone gives no direction.
    const speed = new Float32Array(east.length);
    let known = false;
    for (let t = 0; t < speed.length; t++) {
      speed[t] = wet[t] ? Math.hypot(east[t], north[t]) : NaN;
      if (Number.isNaN(speed[t])) east[t] = north[t] = NaN;
      else known = true;
    }
    if (known)
      flow = packFlow(east, north, speed, count, frameCount, neighbors);
    if (!fields.has("speed")) {
      addField("speed", speed, frameCount, {
        units: "m/s",
        label: "Flow speed",
      });
    }
  }
  if (!fields.has("arrival") || !fields.has("duration")) {
    const arrival = new Float32Array(count).fill(NaN);
    const duration = new Float32Array(count);
    for (let k = 0; k < frameCount; k++) {
      const hours = hoursOf(k);
      const span = k + 1 < frameCount ? hoursOf(k + 1) - hours : 0;
      for (let n = 0; n < count; n++) {
        if (!wet[k * count + n]) continue;
        if (Number.isNaN(arrival[n])) arrival[n] = hours;
        duration[n] += span;
      }
    }
    for (let n = 0; n < count; n++) {
      if (Number.isNaN(arrival[n])) duration[n] = NaN;
    }
    if (!fields.has("arrival")) {
      addField("arrival", arrival, 1, {
        units: "h",
        label: "Hours until wet",
      });
    }
    if (!fields.has("duration")) {
      addField("duration", duration, 1, { units: "h", label: "Hours wet" });
    }
  }
  if (!fields.has("rate") && frameCount > 1) {
    const rate = new Float32Array(heights.length);
    for (let k = 0; k < frameCount; k++) {
      const from = k + 1 < frameCount ? k : k - 1;
      const span = hoursOf(from + 1) - hoursOf(from);
      for (let n = 0; n < count; n++) {
        // Only where wet in either frame; see `depth`.
        if (!wet[from * count + n] && !wet[(from + 1) * count + n]) {
          rate[k * count + n] = NaN;
          continue;
        }
        const a = heights[from * count + n];
        const b = heights[(from + 1) * count + n];
        rate[k * count + n] = (b - a) / span;
      }
    }
    // The drawn level is linear between frames, so its rate holds over each
    // interval.
    addField(
      "rate",
      rate,
      frameCount,
      { units: "m/h", label: "Level change" },
      undefined,
      true,
    );
  }
  progress.report(2, 1);

  // The edges of the cells ever wet, whichever way the axes run.
  const edges = (start: number, step: number, from: number, to: number) => {
    const a = start + (from - 0.5) * step;
    const b = start + (to + 0.5) * step;
    return [Math.min(a, b), Math.max(a, b)];
  };
  const [west, east] = edges(lng.start, lng.step, wetMinX, wetMaxX);
  const [south, north] = edges(lat.start, lat.step, wetMinY, wetMaxY);

  return {
    times,
    changes,
    bounds: { west, south, east, north },
    properties,
    grid: {
      width,
      height,
      lng0: lng.start + minX * lng.step,
      lat0: lat.start + minY * lat.step,
      lngStep: lng.step,
      latStep: lat.step,
    },
    nodes,
    heightBases,
    texels,
    flow,
    fields,
  };
}

/** The group's `flow` attribute, when it names two arrays. */
const flowOf = (value: unknown): [string, string] | undefined =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((name) => typeof name === "string")
    ? (value as [string, string])
    : undefined;

/**
 * The flow as {@link TimeSeriesFloodSeries.flow}, from its components and
 * `speed` frame-major at the nodes, NaN where unknown. A node's value continues
 * past the shoreline as a property's does; one the water never reaches is still.
 * `east` and `north` are filled in place.
 */
function packFlow(
  east: Float32Array,
  north: Float32Array,
  speed: Float32Array,
  count: number,
  frames: number,
  neighbors: Int32Array,
): Uint16Array {
  const fastestEast = new Float32Array(count).fill(NaN);
  const fastestNorth = new Float32Array(count).fill(NaN);
  const fastest = new Float32Array(count).fill(-Infinity);
  for (let k = 0; k < frames; k++) {
    for (let n = 0; n < count; n++) {
      const t = k * count + n;
      // NaN fails the comparison.
      if (speed[t] > fastest[n]) {
        fastest[n] = speed[t];
        fastestEast[n] = east[t];
        fastestNorth[n] = north[t];
      }
    }
  }
  const components = [
    [east, fastestEast],
    [north, fastestNorth],
  ];
  const layer = layerSize(count);
  const data = new Uint16Array(layer * (frames + 1) * 2);
  components.forEach(([values, maximum], c) => {
    for (let k = 0; k < frames; k++) {
      fillNearestValues(values.subarray(k * count, (k + 1) * count), neighbors);
    }
    fillAcrossFrames(values, count, frames);
    fillNearestValues(maximum, neighbors);
    for (let k = 0; k <= frames; k++) {
      const source = k < frames ? values.subarray(k * count) : maximum;
      for (let n = 0; n < count; n++) {
        const v = source[n];
        data[(k * layer + n) * 2 + c] = DataUtils.toHalfFloat(v === v ? v : 0);
      }
    }
  });
  return data;
}

/** The description of a property in its array's CF attributes. */
const describe = (attrs: Record<string, unknown>) => ({
  ...(typeof attrs.units === "string" && { units: attrs.units }),
  ...(typeof attrs.long_name === "string" && { label: attrs.long_name }),
});

// Rough shares of the loading time.
const LEVEL_WORK = 5;
const STORED_DISTANCE_WORK = 1;
const COMPUTED_DISTANCE_WORK = 4;
const PROPERTY_WORK = 2;

/** Reports the progress through stages weighted by their share of the work. */
class Progress {
  private readonly starts: number[] = [];
  private readonly total: number;
  private last = 0;

  constructor(
    private readonly onProgress: ((fraction: number) => void) | undefined,
    private readonly weights: number[],
  ) {
    let sum = 0;
    for (const w of weights) {
      this.starts.push(sum);
      sum += w;
    }
    this.total = sum;
  }

  /** Reports that `done` (0 to 1) of stage `stage` is done. */
  report(stage: number, done: number) {
    if (!this.onProgress) return;
    const fraction =
      (this.starts[stage] + this.weights[stage] * done) / this.total;
    if (fraction <= this.last) return;
    this.last = fraction;
    this.onProgress(fraction);
  }
}

/**
 * Nodes without a value in a frame (the water cannot reach them through the
 * window) take the nearest frame's.
 */
function fillAcrossFrames(values: Float32Array, count: number, frames: number) {
  for (const order of [1, -1]) {
    for (let step = 1; step < frames; step++) {
      const k = order > 0 ? step : frames - 1 - step;
      const from = k - order;
      for (let n = 0; n < count; n++) {
        const t = k * count + n;
        if (Number.isNaN(values[t])) values[t] = values[from * count + n];
      }
    }
  }
}

/** How an array's stored values decode: CF packing and the missing codes. */
function decoding(array: Zarr.Array<Zarr.DataType>) {
  const { attrs } = array;
  return {
    scale: typeof attrs.scale_factor === "number" ? attrs.scale_factor : 1,
    offset: typeof attrs.add_offset === "number" ? attrs.add_offset : 0,
    missing: [array.fillValue, attrs._FillValue, attrs.missing_value].filter(
      (v): v is number => typeof v === "number" && !Number.isNaN(v),
    ),
  };
}

/**
 * Values of a `[time, lat, lng]` array at the nodes, frame-major, or of a
 * `[lat, lng]` array once when `frameCount` is 1, decoded, with NaN where
 * missing; `complete` when nothing is.
 */
async function readAtNodes(
  array: Zarr.Array<Zarr.DataType>,
  nodes: Uint32Array,
  width: number,
  minX: number,
  minY: number,
  frameCount: number,
  reads: ChunkReads,
): Promise<{ values: Float32Array; complete: boolean }> {
  const { scale, offset, missing } = decoding(array);
  const fill = missing.length === 1 ? missing[0] : NaN;
  const isMissing = (v: number) =>
    v !== v || v === fill || (missing.length > 1 && missing.includes(v));
  const count = nodes.length;
  const values = new Float32Array(count * frameCount).fill(NaN);
  const timed = array.shape.length === 3;
  const [tileRows, tileCols] = array.chunks.slice(timed ? 1 : 0);
  const cols = array.shape[timed ? 2 : 1];
  const tilesX = Math.ceil(cols / tileCols);
  const byTile = new Map<number, number[]>();
  for (let n = 0; n < count; n++) {
    const i = nodes[n];
    const x = (i % width) + minX;
    const y = Math.floor(i / width) + minY;
    const key = Math.floor(y / tileRows) * tilesX + Math.floor(x / tileCols);
    let list = byTile.get(key);
    if (!list) byTile.set(key, (list = []));
    list.push(n);
  }
  let missingCount = 0;
  await mapLimit([...byTile], FETCH_CONCURRENCY, async ([key, list]) => {
    const ty = Math.floor(key / tilesX);
    const tx = key % tilesX;
    const tile = await readTile(array, ty, tx, reads);
    for (const n of list) {
      const x = (nodes[n] % width) + minX - tx * tileCols;
      const y = Math.floor(nodes[n] / width) + minY - ty * tileRows;
      for (let c = 0; c < tile.chunks.length; c++) {
        const { data, stride } = tile.chunks[c];
        const k0 = c * tile.timeChunk;
        const frames = Math.min(tile.timeChunk, frameCount - k0);
        if (!data) {
          missingCount += frames;
          continue;
        }
        const base = y * stride[1] + x * stride[2];
        for (let kk = 0; kk < frames; kk++) {
          const v = data[base + kk * stride[0]];
          if (isMissing(v)) missingCount++;
          else values[(k0 + kk) * count + n] = v * scale + offset;
        }
      }
    }
  });
  return { values, complete: missingCount === 0 };
}

const FETCH_CONCURRENCY = 8;
const HALF_FLOAT_MAX = 65504;

/** Runs `fn` over `items`, at most `limit` at a time. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/** The store chunks are read from, and the reads of it that found nothing. */
type ChunkReads = {
  store: Readable;
  signal: AbortSignal | undefined;
  /** The options of each read that found no value. */
  missed: WeakSet<object>;
};

/**
 * Wraps `store` to tell missing chunks apart: zarrita fills a missing chunk
 * with the fill value, which a Zarr v2 `null` fill value makes 0.
 */
function trackMisses(
  store: Readable,
  signal: AbortSignal | undefined,
): ChunkReads {
  const missed = new WeakSet<object>();
  const record = (
    value: Uint8Array | undefined,
    options: object | undefined,
  ) => {
    if (value === undefined && options) missed.add(options);
    return value;
  };
  const getRange = store.getRange?.bind(store);
  return {
    store: {
      get: async (key, options) =>
        record(await store.get(key, options), options),
      ...(getRange && {
        getRange: async (key, range, options) =>
          record(await getRange(key, range, options), options),
      }),
    },
    signal,
    missed,
  };
}

/** A chunk's values, or none where the chunk is missing, with its strides. */
type TileChunk = {
  data: ArrayLike<number> | undefined;
  /** Elements per step along time, row and column. */
  stride: [number, number, number];
};

/**
 * Every frame of the chunk-aligned tile at chunk row `ty`, column `tx` of a
 * `[time, lat, lng]` array, as one chunk per `timeChunk` frames, or the one
 * chunk of a `[lat, lng]` array as a single frame.
 */
async function readTile(
  array: Zarr.Array<Zarr.DataType>,
  ty: number,
  tx: number,
  { signal, missed }: ChunkReads,
): Promise<{ chunks: TileChunk[]; timeChunk: number }> {
  const timed = array.shape.length === 3;
  const timeChunk = timed ? array.chunks[0] : 1;
  const chunks = await Promise.all(
    Array.from(
      { length: timed ? Math.ceil(array.shape[0] / timeChunk) : 1 },
      async (_, tc): Promise<TileChunk> => {
        // zarrita passes these options on to the store as they are.
        const options = { signal };
        const chunk = await array.getChunk(
          timed ? [tc, ty, tx] : [ty, tx],
          options,
        );
        const stride = chunk.stride;
        return {
          data: missed.has(options)
            ? undefined
            : (chunk.data as ArrayLike<number>),
          stride: timed
            ? [stride[0], stride[1], stride[2]]
            : [0, stride[0], stride[1]],
        };
      },
    ),
  );
  return { chunks, timeChunk };
}
