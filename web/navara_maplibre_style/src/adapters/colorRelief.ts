/**
 * Converts a color-relief layer's `color-relief-color` expression into the
 * colorMap and colorStops of a Navara elevation heatmap.
 */

import { Color as MapLibreColor } from "@maplibre/maplibre-gl-style-spec";

import { isMapLibreColor } from "../engine/types";

/** RGBA color, each component in [0, 1]. */
export type RGBA = [number, number, number, number];

/**
 * One `elevation → color` stop of a color-relief expression. `color` is
 * premultiplied by its alpha, as MapLibre stores and interpolates it.
 */
export type ColorReliefStop = { elevation: number; color: RGBA };

/** Elevation heatmap inputs derived from color-relief stops. */
export type ColorReliefRamp = {
  minHeight: number;
  maxHeight: number;
  /** Flattened straight-alpha RGBA, one entry per stop. */
  colorMap: Float32Array;
  /** Stop elevations in meters, ascending, one per colorMap entry. */
  colorStops: Float32Array;
};

/** Operators MapLibre parses as an `Interpolate` expression. */
const INTERPOLATE_OPERATORS = new Set([
  "interpolate",
  "interpolate-hcl",
  "interpolate-lab",
]);

/**
 * Extract the stops of a color-relief `color-relief-color` expression, sorted
 * by elevation, or `undefined` when it is not an interpolate expression whose
 * input uses `["elevation"]`.
 *
 * With `evaluateAt` (the whole expression evaluated with a given elevation),
 * this mirrors MapLibre's `ColorReliefStyleLayer._createColorRamp`: the stop
 * inputs are taken as elevations in meters and each stop's color is the
 * expression evaluated at that elevation. So the input may be any expression
 * of `["elevation"]` (e.g. `["*", ["elevation"], 3.28]`), and stop colors may
 * be any color expression, including ones that read `["elevation"]`.
 *
 * Without it (no style engine), only the plain form is understood: the input
 * must be `["elevation"]` and stop colors must be color strings.
 *
 * Either way only the stop colors are kept, and colors between stops are
 * interpolated linearly in premultiplied RGBA whatever the interpolation type
 * (`exponential`, `cubic-bezier`) or operator (`interpolate-hcl`,
 * `interpolate-lab`), like MapLibre. A stop whose color fails to resolve is
 * dropped without shifting the others.
 */
export function parseColorReliefStops(
  expression: unknown,
  evaluateAt?: (elevation: number) => unknown,
): ColorReliefStop[] | undefined {
  if (
    !Array.isArray(expression) ||
    !INTERPOLATE_OPERATORS.has(expression[0]) ||
    !Array.isArray(expression[1]) ||
    !usesElevation(expression[2]) ||
    (!evaluateAt && !isBareElevation(expression[2]))
  ) {
    return undefined;
  }

  const stops: ColorReliefStop[] = [];
  // Skip the first 3 elements: ["interpolate", ["linear"], <input>]
  for (let i = 3; i < expression.length; i += 2) {
    const elevation = expression[i];
    const colorExpr = expression[i + 1];
    if (typeof elevation !== "number") continue;
    const c = toMapLibreColor(
      evaluateAt
        ? evaluateAt(elevation)
        : typeof colorExpr === "string"
          ? colorExpr
          : undefined,
    );
    // MapLibre's Color holds premultiplied r/g/b.
    if (c) stops.push({ elevation, color: [c.r, c.g, c.b, c.a] });
  }
  return stops.sort((a, b) => a.elevation - b.elevation);
}

const isBareElevation = (expr: unknown): boolean =>
  Array.isArray(expr) && expr.length === 1 && expr[0] === "elevation";

/** Whether an expression reads `["elevation"]` anywhere. */
function usesElevation(expr: unknown): boolean {
  if (!Array.isArray(expr)) return false;
  return isBareElevation(expr) || expr.some(usesElevation);
}

/**
 * A color string or an evaluated color, as a (premultiplied) MapLibre `Color`.
 * Engines differ: JsStyleEngine returns a `Color` instance, already
 * premultiplied; RustStyleEngine returns a plain straight-alpha
 * `{ r, g, b, a }` object (maplibre-expr's `Color`), premultiplied here.
 */
function toMapLibreColor(value: unknown): MapLibreColor | undefined {
  if (typeof value === "string") return MapLibreColor.parse(value);
  if (value instanceof MapLibreColor) return value;
  if (isMapLibreColor(value)) {
    return new MapLibreColor(value.r, value.g, value.b, value.a ?? 1, false);
  }
  return undefined;
}

/**
 * Build the elevation heatmap inputs from sorted stops, or `undefined` when
 * there are none. The engine places each color exactly at its stop elevation
 * and interpolates between neighbors in premultiplied space, as MapLibre does.
 * minHeight/maxHeight span the stops (a single stop's range is widened by 1).
 */
export function toColorReliefRamp(
  stops: ColorReliefStop[],
): ColorReliefRamp | undefined {
  if (stops.length === 0) return undefined;
  const minHeight = stops[0].elevation;
  let maxHeight = stops[stops.length - 1].elevation;
  if (maxHeight <= minHeight) maxHeight = minHeight + 1;
  const colorMap = new Float32Array(stops.length * 4);
  stops.forEach(({ color: [r, g, b, a] }, i) => {
    // Un-premultiply; a fully transparent stop contributes no color anyway.
    colorMap.set(a > 0 ? [r / a, g / a, b / a, a] : [0, 0, 0, 0], i * 4);
  });
  const colorStops = new Float32Array(stops.map((s) => s.elevation));
  return { minHeight, maxHeight, colorMap, colorStops };
}
