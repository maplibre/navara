import { DataUtils } from "three";

import { layerSize } from "./layout";
import type { TimeSeriesFloodSeries } from "./series";

/** The water at a point, as the surface draws it. */
export type TimeSeriesFloodSample = {
  /** Whether the point is under water. */
  wet: boolean;
  /** Water-surface height in meters above the WGS84 ellipsoid where wet. */
  level: number | undefined;
  /**
   * The values of the series' properties at the point: one that does not
   * change over time wherever it has a value, one that does only where wet.
   */
  properties: Record<string, number>;
};

/**
 * The water at `lng`, `lat` (degrees) in `frame`: a fractional frame
 * interpolates to the next one, as the surface does; `"max"` gives each
 * value's maximum over the series, as the surface with `extent: "max"`. A point takes its cell's values.
 * `undefined` where the water never reaches.
 */
export function sampleTimeSeriesFlood(
  series: TimeSeriesFloodSeries,
  { lng, lat }: { lng: number; lat: number },
  frame: number | "max",
): TimeSeriesFloodSample | undefined {
  const { grid, nodes, texels, heightBases, times } = series;
  const x = Math.round((lng - grid.lng0) / grid.lngStep);
  const y = Math.round((lat - grid.lat0) / grid.latStep);
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return undefined;
  const n = indexOf(nodes, y * grid.width + x);
  if (n < 0) return undefined;
  const frameCount = times.length;
  const layer = layerSize(nodes.length);
  const half = (k: number, channel: number) =>
    DataUtils.fromHalfFloat(texels[(k * layer + n) * 2 + channel]);
  // The last layer holds the maximum: negative distance where ever wet.
  if (half(frameCount, 1) >= 0) return undefined;

  let k0 = frameCount;
  let k1 = frameCount;
  let t = 0;
  if (frame !== "max") {
    const f = Math.min(Math.max(frame, 0), frameCount - 1);
    k0 = Math.floor(f);
    k1 = Math.min(k0 + 1, frameCount - 1);
    t = f - k0;
  }
  const mix = (a: number, b: number) => a + (b - a) * t;
  const wet = mix(half(k0, 1), half(k1, 1)) < 0;
  const properties: Record<string, number> = {};
  for (const [name, field] of series.fields) {
    let value: number;
    if (field.frames === 1) {
      value = DataUtils.fromHalfFloat(field.data[n]);
    } else {
      if (!wet) continue;
      const a = DataUtils.fromHalfFloat(field.data[k0 * layer + n]);
      const b = DataUtils.fromHalfFloat(field.data[k1 * layer + n]);
      value = field.stepwise
        ? a
        : Number.isNaN(a)
          ? b
          : Number.isNaN(b)
            ? a
            : mix(a, b);
    }
    if (!Number.isNaN(value)) properties[name] = value + field.min;
  }
  return {
    wet,
    level: wet ? heightBases[n] + mix(half(k0, 0), half(k1, 0)) : undefined,
    properties,
  };
}

/**
 * The fractional frame showing `time`, between the frames around it,
 * clamped to the first and last frame. The frames need not be evenly spaced.
 */
export function timeToFrame(
  series: TimeSeriesFloodSeries,
  time: Date | number,
): number {
  const ms = typeof time === "number" ? time : time.getTime();
  const { times } = series;
  if (ms <= times[0].getTime()) return 0;
  const last = times.length - 1;
  if (ms >= times[last].getTime()) return last;
  // The last frame at or before `ms`.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid].getTime() <= ms) lo = mid;
    else hi = mid;
  }
  const a = times[lo].getTime();
  return lo + (ms - a) / (times[lo + 1].getTime() - a);
}

/** The time `frame` shows, interpolated between the frames around it. */
export function frameToTime(
  series: TimeSeriesFloodSeries,
  frame: number,
): Date {
  const { times } = series;
  const f = Math.min(Math.max(frame, 0), times.length - 1);
  const k = Math.floor(f);
  const a = times[k].getTime();
  const b = times[Math.min(k + 1, times.length - 1)].getTime();
  return new Date(a + (b - a) * (f - k));
}

/** Index of `value` in the ascending `array`, or -1. */
function indexOf(array: Uint32Array, value: number) {
  let lo = 0;
  let hi = array.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (array[mid] < value) lo = mid + 1;
    else if (array[mid] > value) hi = mid - 1;
    else return mid;
  }
  return -1;
}
