/**
 * Writes a water-surface series as the Zarr group `loadTimeSeriesFlood`
 * reads:
 *
 * - `time` `[time]`: CF `seconds since 1970-01-01T00:00:00Z`;
 * - `lat` `[lat]`, `lon` `[lon]`: cell centers in degrees;
 * - `water_level` `[time, lat, lon]`: water-surface height above the WGS84
 *   ellipsoid, missing where dry;
 * - `signed_distance` `[time, lat, lon]`: the optional precomputed distance
 *   to each frame's shoreline, so the browser skips computing it;
 * - one array per property of the frames, `[time, lat, lon]`, or `[lat, lon]`
 *   when its value never changes over time.
 *
 * The group's `properties` attribute lists the property arrays,
 * `signed_distance` names the distance array, and `flow` names the properties
 * `flow_east` and `flow_north` when both are written. Fields with a precision are
 * packed as CF-scaled integers (see `pack.ts`); each property array records
 * the range of its values (see `stats.ts`).
 *
 * Chunks are 128 × 128 cells over all frames, compressed with zstd; only
 * chunks with data are written. With a tolerance, only keyframes are written
 * (see `keyframes`).
 */
import type { Mutable } from "@zarrita/storage";
import * as zarr from "zarrita";

import { dilate, extendLevels, signedDistance } from "../derive";
import { layerSize } from "../layout";
import { pack, planPacking, type PackingPlan } from "../pack";
import { ACTUAL_RANGE_ATTR, rangeOf, ROBUST_RANGE_ATTR } from "../stats";

import {
  METERS_PER_DEGREE_LAT,
  METERS_PER_DEGREE_LNG_AT_EQUATOR,
  type Grid,
} from "./grid";
import { keyframes, type KeyframeTolerance } from "./keyframes";
import { refineSignedDistance } from "./shoreline";

const TILE = 128;
const INT16_FILL = -32768;
// Signed distances are stored as int16 in steps of this many meters, which
// compresses far better than float32 for a smooth field.
const DISTANCE_SCALE = 0.5;
// Water levels are packed to this many meters, finer than the half floats the
// surface draws them with.
const LEVEL_PRECISION = 0.01;
export const SIGNED_DISTANCE_ARRAY = "signed_distance";
/** The properties holding the flow velocity, eastward and northward in m/s. */
export const FLOW_PROPERTIES = ["flow_east", "flow_north"];

/** A store `writeFloodZarr` writes to: a zarrita writable store. */
export type FloodStore = Mutable;

// zstd's window reaches the same tile in earlier frames, where gzip's 32 KB
// does not. A byte shuffle before it saves another ~15%, but zarrita undoes
// it in JavaScript on the main thread, slower than that saves on a fast link.
const CODECS = [
  { name: "bytes", configuration: { endian: "little" } },
  { name: "zstd", configuration: { level: 19, checksum: false } },
];

/** How closely kept frames must interpolate to a dropped one; see `keyframes`. */
export type FloodTolerance = Omit<KeyframeTolerance, "shoreDistance">;

/** What `writeFloodZarr` wrote. */
export type FloodZarrInfo = {
  frameCount: number;
  width: number;
  height: number;
  /** Cell size in meters. */
  dx: number;
  dy: number;
  wetCells: number;
  tiles: number;
  /**
   * Bytes of the GPU textures a viewer uploads the series as: the water
   * surface, the flow if stored, and each stored property while shown. A
   * property derived on load (see `loadTimeSeriesFlood`) takes as much as a
   * stored one, with time or without.
   */
  textureBytes: {
    water: number;
    flow?: number;
    properties: Record<string, number>;
  };
};

/** The wet cells of one frame, as cell indices on the grid, and their level. */
export type FloodFrame = {
  x: Int32Array;
  y: Int32Array;
  level: Float32Array;
  /** Per property, its value at each cell; NaN where missing. */
  properties?: Record<string, Float32Array>;
};

export type FloodSeries = {
  grid: Grid;
  /** Seconds since the Unix epoch, increasing. */
  times: Float64Array;
  frames: FloodFrame[];
  /**
   * Per frame, the exact shoreline as segments in grid-node units, for
   * outlines that do not follow the cells (see `refineSignedDistance`).
   */
  shorelines?: Float64Array[];
  /** Attributes of the group. */
  attributes: Record<string, unknown>;
  /** Keeps only the keyframes within it; the shoreline distance is a cell. */
  tolerance?: FloodTolerance;
  /**
   * Per property, the step its values are stored at, which packs them as
   * integers; a property without one is stored as float32.
   */
  precision?: Record<string, number>;
  /** Per property, its unit, stored as the CF `units` attribute. */
  units?: Record<string, string>;
  /** Per property, its description, stored as the CF `long_name` attribute. */
  labels?: Record<string, string>;
};

/**
 * Writes `series` as a Zarr group at the root of `store`, which should be
 * empty: a `Map` in the browser, or a `FileSystemStore` from
 * `@zarrita/storage/fs` in Node.
 */
export const writeFloodZarr = async (
  store: FloodStore,
  {
    grid,
    times,
    frames,
    shorelines,
    attributes,
    tolerance,
    precision = {},
    units = {},
    labels = {},
  }: FloodSeries,
): Promise<FloodZarrInfo> => {
  if (!frames.length) throw new Error("No frames.");
  if (frames.length !== times.length) {
    throw new Error("Each frame needs a time.");
  }
  if (times.some((t, k) => k > 0 && t <= times[k - 1])) {
    throw new Error("The frame times must increase.");
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of frames) {
    for (let i = 0; i < x.length; i++) {
      minX = Math.min(minX, x[i]);
      minY = Math.min(minY, y[i]);
      maxX = Math.max(maxX, x[i]);
      maxY = Math.max(maxY, y[i]);
    }
  }
  if (minX === Infinity) throw new Error("No wet cells.");
  // One dry cell around the water, which the shoreline is drawn up to.
  const originX = minX - 1;
  const originY = minY - 1;
  const width = maxX - minX + 3;
  const height = maxY - minY + 3;
  const cellOf = (frame: FloodFrame, i: number) =>
    (frame.y[i] - originY) * width + frame.x[i] - originX;

  const everWet = new Uint8Array(width * height);
  for (const frame of frames) {
    for (let i = 0; i < frame.x.length; i++) everWet[cellOf(frame, i)] = 1;
  }
  const domain = dilate(everWet, width, height);
  // Values are kept for the domain cells only, frame-major.
  const domainCells: number[] = [];
  const slot = new Int32Array(width * height).fill(-1);
  domain.forEach((m, i) => {
    if (m) slot[i] = domainCells.push(i) - 1;
  });
  const count = domainCells.length;

  const latMid = ((minY + maxY) / 2) * grid.latStep + grid.latOffset;
  const dx =
    METERS_PER_DEGREE_LNG_AT_EQUATOR *
    Math.cos((latMid * Math.PI) / 180) *
    grid.lngStep;
  const dy = METERS_PER_DEGREE_LAT * grid.latStep;

  let levels = new Float32Array(frames.length * count).fill(NaN);
  let distances = new Float32Array(frames.length * count);
  const propertyNames = [
    ...new Set(frames.flatMap((f) => Object.keys(f.properties ?? {}))),
  ];
  const properties = new Map(
    propertyNames.map((name) => [
      name,
      new Float32Array(frames.length * count).fill(NaN),
    ]),
  );
  // The levels as the surface draws them, to pick keyframes by.
  const drawnLevels = tolerance && new Float32Array(frames.length * count);
  const wet = new Uint8Array(width * height);
  const gridLevels = new Float32Array(width * height);
  frames.forEach((frame, k) => {
    wet.fill(0);
    gridLevels.fill(NaN);
    for (let i = 0; i < frame.x.length; i++) {
      const c = cellOf(frame, i);
      wet[c] = 1;
      levels[k * count + slot[c]] = frame.level[i];
      gridLevels[c] = frame.level[i];
      for (const [name, values] of properties) {
        values[k * count + slot[c]] = frame.properties?.[name]?.[i] ?? NaN;
      }
    }
    if (drawnLevels) {
      const extended = extendLevels(gridLevels, domain, width, height);
      domainCells.forEach((c, n) => (drawnLevels[k * count + n] = extended[c]));
    }
    let distance = signedDistance(wet, width, height, dx, dy);
    if (shorelines) {
      const segments = shorelines[k].map(
        (v, i) => v - (i % 2 ? originY : originX),
      );
      distance = refineSignedDistance(
        distance,
        wet,
        segments,
        width,
        height,
        dx,
        dy,
      );
    }
    // As stored.
    domainCells.forEach(
      (c, n) =>
        (distances[k * count + n] =
          Math.max(
            -32767,
            Math.min(32767, Math.round(distance[c] / DISTANCE_SCALE)),
          ) * DISTANCE_SCALE),
    );
  });

  let keptTimes = times;
  if (drawnLevels) {
    // Cells the water cannot reach in a frame take the nearest frame's level,
    // as the surface does.
    for (const order of [1, -1]) {
      for (let step = 1; step < frames.length; step++) {
        const k = order > 0 ? step : frames.length - 1 - step;
        for (let n = 0; n < count; n++) {
          if (Number.isNaN(drawnLevels[k * count + n])) {
            drawnLevels[k * count + n] = drawnLevels[(k - order) * count + n];
          }
        }
      }
    }
    const kept = keyframes(times, drawnLevels, distances, count, {
      ...tolerance,
      shoreDistance: Math.max(dx, dy),
    });
    const pick = (values: Float32Array) => {
      const out = new Float32Array(kept.length * count);
      kept.forEach((k, j) =>
        out.set(values.subarray(k * count, (k + 1) * count), j * count),
      );
      return out;
    };
    levels = pick(levels);
    distances = pick(distances);
    for (const [name, values] of properties) properties.set(name, pick(values));
    keptTimes = Float64Array.from(kept, (k) => times[k]);
  }
  const frameCount = keptTimes.length;
  const hasFlow = FLOW_PROPERTIES.every((name) => properties.has(name));

  const root = await zarr.create(store, {
    attributes: {
      ...attributes,
      vertical_datum: "WGS84 ellipsoid",
      signed_distance: SIGNED_DISTANCE_ARRAY,
      properties: propertyNames,
      ...(hasFlow && { flow: FLOW_PROPERTIES }),
    },
  });

  const coordinate = async (
    name: string,
    values: Float64Array,
    attributes: Record<string, unknown>,
  ) => {
    const array = await zarr.create(root.resolve(name), {
      shape: [values.length],
      chunkShape: [values.length],
      dtype: "float64",
      dimensionNames: [name],
      attributes,
    });
    await zarr.set(array, null, {
      data: values,
      shape: [values.length],
      stride: [1],
    });
  };
  await coordinate("time", keptTimes, {
    units: "seconds since 1970-01-01T00:00:00Z",
    standard_name: "time",
  });
  await coordinate(
    "lat",
    Float64Array.from(
      { length: height },
      (_, y) => (originY + y + 0.5) * grid.latStep + grid.latOffset,
    ),
    { units: "degrees_north", standard_name: "latitude" },
  );
  await coordinate(
    "lon",
    Float64Array.from(
      { length: width },
      (_, x) => (originX + x + 0.5) * grid.lngStep + grid.lngOffset,
    ),
    { units: "degrees_east", standard_name: "longitude" },
  );

  /**
   * Writes the tiles holding a cell of `mask` from `values` (frame-major over
   * the domain cells, or over them once for a field that is not `timed`);
   * cells outside the mask keep the fill value. Values are packed by `plan`.
   */
  const field = async (
    name: string,
    values: Float32Array,
    mask: Uint8Array,
    attributes: Record<string, unknown>,
    plan: PackingPlan,
    timed = true,
  ) => {
    const shape = timed ? [frameCount, height, width] : [height, width];
    const array = await zarr.create(root.resolve(name), {
      shape,
      chunkShape: timed ? [frameCount, TILE, TILE] : [TILE, TILE],
      dtype: plan.dtype,
      fillValue: plan.fill,
      codecs: CODECS,
      dimensionNames: timed ? ["time", "lat", "lon"] : ["lat", "lon"],
      attributes:
        plan.dtype === "float32"
          ? attributes
          : {
              ...attributes,
              scale_factor: plan.scale,
              add_offset: plan.offset,
            },
    });
    const layers = timed ? frameCount : 1;
    let written = 0;
    for (let y0 = 0; y0 < height; y0 += TILE) {
      for (let x0 = 0; x0 < width; x0 += TILE) {
        const h = Math.min(TILE, height - y0);
        const w = Math.min(TILE, width - x0);
        let any = false;
        for (let y = y0; y < y0 + h && !any; y++) {
          for (let x = x0; x < x0 + w && !any; x++) any = !!mask[y * width + x];
        }
        if (!any) continue;
        const tile = new Float32Array(layers * h * w).fill(NaN);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y0 + y) * width + x0 + x;
            if (!mask[i]) continue;
            for (let k = 0; k < layers; k++) {
              tile[(k * h + y) * w + x] = values[k * count + slot[i]];
            }
          }
        }
        const data = pack(tile, plan);
        await zarr.set(
          array,
          timed
            ? [null, zarr.slice(y0, y0 + h), zarr.slice(x0, x0 + w)]
            : [zarr.slice(y0, y0 + h), zarr.slice(x0, x0 + w)],
          timed
            ? { data, shape: [frameCount, h, w], stride: [h * w, w, 1] }
            : { data, shape: [h, w], stride: [w, 1] },
        );
        written++;
      }
    }
    return written;
  };
  const levelRange = rangeOf(levels);
  const tiles = await field(
    "water_level",
    levels,
    everWet,
    {
      units: "m",
      long_name: "water-surface height above the WGS84 ellipsoid",
    },
    planPacking(levelRange.min, levelRange.max, LEVEL_PRECISION),
  );
  await field(
    SIGNED_DISTANCE_ARRAY,
    distances,
    domain,
    {
      units: "m",
      long_name: "signed distance to the shoreline, negative where wet",
    },
    {
      dtype: "int16",
      scale: DISTANCE_SCALE,
      offset: 0,
      fill: INT16_FILL,
    },
  );
  // Half floats per node, a layer per frame and one for the maximum.
  const layer = layerSize(count);
  const textureBytes = {
    water: layer * (frameCount + 1) * 2 * 2,
    ...(hasFlow && { flow: layer * (frameCount + 1) * 2 * 2 }),
    properties: {} as Record<string, number>,
  };
  for (const [name, values] of properties) {
    // A property with one value per cell over all frames has no time.
    const constant = new Float32Array(count).fill(NaN);
    let timed = false;
    for (let k = 0; k < frameCount && !timed; k++) {
      for (let n = 0; n < count; n++) {
        const v = values[k * count + n];
        if (Number.isNaN(v)) continue;
        if (Number.isNaN(constant[n])) constant[n] = v;
        else if (constant[n] !== v) {
          timed = true;
          break;
        }
      }
    }
    // The range, so a reader need not measure it.
    const range = rangeOf(values);
    await field(
      name,
      timed ? values : constant,
      everWet,
      {
        ...(units[name] !== undefined && { units: units[name] }),
        ...(labels[name] !== undefined && { long_name: labels[name] }),
        [ACTUAL_RANGE_ATTR]: [range.min, range.max],
        [ROBUST_RANGE_ATTR]: [range.low, range.high],
      },
      planPacking(range.min, range.max, precision[name]),
      timed,
    );
    if (!hasFlow || !FLOW_PROPERTIES.includes(name)) {
      textureBytes.properties[name] = layer * (timed ? frameCount + 1 : 1) * 2;
    }
  }

  return {
    frameCount,
    width,
    height,
    dx,
    dy,
    wetCells: everWet.reduce((a, b) => a + b, 0),
    tiles,
    textureBytes,
  };
};
