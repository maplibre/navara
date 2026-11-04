/**
 * Shared utilities for StyleEngine implementations.
 */

import {
  expression,
  migrate,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

import { LAYOUT_SPECS_BY_TYPE } from "./layoutSpecs";
import { PAINT_SPECS_BY_TYPE } from "./paintSpecs";
import type { LayerType, ParsedStyle, PropertySpec, StyleValue } from "./types";

/**
 * Migrate legacy features (v7, functions, tokens, colors) to the current
 * spec, then validate the result.
 *
 * Only `error` results reject the style. `warning` results (e.g. a filter
 * mixing legacy and expression syntax) are logged and rendering continues,
 * like maplibre-gl-js.
 */
export function validateAndMigrateStyle(raw: unknown): ParsedStyle {
  const style = raw as StyleSpecification;
  avoidDegenerateStepCurves(style);
  const migrated = migrate(style);

  const results = validateStyleMin(migrated);
  const errors = results.filter((e) => e.severity !== "warning");
  const warnings = results.filter((e) => e.severity === "warning");

  if (errors.length > 0) {
    const errorMessages = errors.map((e) => e.message);
    throw new Error(`Invalid MapLibre Style: ${errorMessages.join(", ")}`);
  }
  for (const warning of warnings) {
    console.warn(`MapLibre Style: ${warning.message}`);
  }

  return migrated as ParsedStyle;
}

type LegacyStop = [unknown, unknown];

/**
 * Work around a `migrate()` bug in @maplibre/maplibre-gl-style-spec (seen in
 * 26.4.4): a legacy function whose `step` would get a single stop is converted
 * to an invalid expression.
 *
 * `fixupDegenerateStepCurve` (src/function/convert.ts) pads
 * `["step", input, out]` with `push(0); push(expression[3])`, but
 * `expression[3]` is the `0` it just pushed, so the result is
 * `["step", input, out, 0, 0]` instead of `["step", input, out, 0, out]`.
 * A color property then fails to compile (regressions/mapbox-gl-js#4146), and
 * a number property silently evaluates to 0. maplibre-gl-js is unaffected
 * because it evaluates legacy functions directly and never migrates at render
 * time.
 *
 * The fix repeats the lone stop of each curve that `migrate()` would build
 * as a `step`, so the curve never degenerates. A step over two identical stops
 * gives the same output. Runs before `migrate()` and before validation (which
 * would reject the repeated stop), so it skips anything malformed and leaves
 * it to validation. Mutates in place, like `migrate()`.
 *
 * Reported upstream:
 * https://github.com/maplibre/maplibre-style-spec/issues/1962. Remove this
 * once a style-spec release with the fix is in use.
 */
function avoidDegenerateStepCurves(style: StyleSpecification): void {
  if (!Array.isArray(style?.layers)) return;
  for (const layer of style.layers as unknown[]) {
    if (!layer || typeof layer !== "object") continue;
    const { type, paint, layout } = layer as {
      type?: unknown;
      paint?: unknown;
      layout?: unknown;
    };
    if (typeof type !== "string") continue;
    const groups = [
      [paint, getPaintSpec],
      [layout, getLayoutSpec],
    ] as const;
    for (const [props, getSpec] of groups) {
      if (!props || typeof props !== "object") continue;
      const record = props as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        const spec = getSpec(type as LayerType, key);
        if (!spec?.expression) continue;
        const fixed = fixLegacyFunctionStops(
          value,
          spec.expression.interpolated,
        );
        if (fixed) record[key] = fixed;
      }
    }
  }
}

/**
 * Returns a copy of the legacy function `value` with its lone stops repeated
 * where `migrate()` builds a `step`, or undefined when nothing needs fixing.
 *
 * Mirrors `convertFunction` in style-spec's src/function/convert.ts: a zoom
 * or property function becomes a `step` when its type is `interval` (the
 * default for a property that cannot be interpolated). A zoom-and-property
 * function has an outer zoom curve, a `step` when the property cannot be
 * interpolated, and per-zoom inner property curves typed like the function.
 */
function fixLegacyFunctionStops(
  value: unknown,
  interpolated: boolean,
): object | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const fn = value as { type?: unknown; stops?: unknown };
  if (!Array.isArray(fn.stops) || fn.stops.length === 0) return undefined;
  if (!fn.stops.every((s) => Array.isArray(s) && s.length === 2)) {
    return undefined;
  }
  const stops = fn.stops as LegacyStop[];
  const type = fn.type ?? (interpolated ? "exponential" : "interval");
  const innerIsStep = type === "interval";

  const isZoomAndProperty =
    stops[0][0] !== null && typeof stops[0][0] === "object";
  if (!isZoomAndProperty) {
    return innerIsStep && stops.length === 1
      ? { ...fn, stops: [stops[0], stops[0]] }
      : undefined;
  }

  // Zoom-and-property function: stop inputs are `{ zoom, value }`.
  const byZoom = new Map<number, LegacyStop[]>();
  for (const stop of stops) {
    const input = stop[0] as { zoom?: unknown } | null;
    if (!input || typeof input !== "object" || typeof input.zoom !== "number") {
      return undefined;
    }
    const group = byZoom.get(input.zoom) ?? [];
    group.push(stop);
    byZoom.set(input.zoom, group);
  }
  const zoomGroups = [...byZoom.values()].map((group) =>
    innerIsStep && group.length === 1 ? [group[0], group[0]] : group,
  );
  const outerIsStep = !interpolated;
  if (outerIsStep && zoomGroups.length === 1) {
    const [[firstInput]] = zoomGroups[0];
    const zoom = (firstInput as { zoom: number }).zoom;
    zoomGroups.push(
      zoomGroups[0].map(([input, output]): LegacyStop => [
        { ...(input as object), zoom: zoom + 1 },
        output,
      ]),
    );
  }
  const fixedStops = zoomGroups.flat();
  return fixedStops.length === stops.length
    ? undefined
    : { ...fn, stops: fixedStops };
}

/**
 * Get paint property spec for a layer type.
 */
export function getPaintSpec(
  layerType: LayerType,
  propertyName: string,
): PropertySpec | undefined {
  const paintSpecs = PAINT_SPECS_BY_TYPE[layerType];
  if (!paintSpecs) {
    return undefined;
  }

  const spec = paintSpecs[propertyName as keyof typeof paintSpecs];
  return spec as PropertySpec | undefined;
}

/**
 * Get layout property spec for a layer type.
 */
export function getLayoutSpec(
  layerType: LayerType,
  propertyName: string,
): PropertySpec | undefined {
  const layoutSpecs = LAYOUT_SPECS_BY_TYPE[layerType];
  if (!layoutSpecs) {
    return undefined;
  }

  const spec = layoutSpecs[propertyName as keyof typeof layoutSpecs];
  return spec as PropertySpec | undefined;
}

/**
 * Get default value for a property type.
 * Used as fallback when spec.default is undefined or evaluation fails.
 *
 * For unknown types, returns an empty string as a safe fallback.
 * This allows graceful degradation in production if MapLibre introduces new types.
 */
export function getTypeDefault(type: PropertySpec["type"]): StyleValue {
  switch (type) {
    case "color":
      return { r: 0, g: 0, b: 0, a: 1 }; // Black in MapLibreColor format
    case "number":
      return 0;
    case "boolean":
      return false;
    case "string":
      return "";
    case "formatted":
      return ""; // text-field default (empty formatted text)
    case "resolvedImage":
      return ""; // icon-image default (empty image name)
    case "array":
      return [];
    default:
      return ""; // Safe fallback for unknown types
  }
}

const { isExpression } = expression;

/** Property types whose constant value is an array. */
const ARRAY_TYPES: ReadonlySet<string> = new Set([
  "array",
  "variableAnchorOffsetCollection",
]);

/**
 * Whether an array style value starting with a string is a literal of an
 * array-typed property rather than an expression: its first element is no
 * expression operator, as MapLibre decides it. Covers font stacks
 * (`["Open Sans Regular"]`) and enum arrays (`text-variable-anchor:
 * ["top", "bottom"]`, a `text-variable-anchor-offset` collection). For any
 * other type such an array is an unknown expression and must fail.
 */
export function isLiteralArray(expr: unknown, spec: PropertySpec): boolean {
  return (
    ARRAY_TYPES.has(spec.type) &&
    Array.isArray(expr) &&
    typeof expr[0] === "string" &&
    !isExpression(expr)
  );
}
