/**
 * Shared utilities for StyleEngine implementations.
 */

import { expression } from "@maplibre/maplibre-gl-style-spec";

import { LAYOUT_SPECS_BY_TYPE } from "./layoutSpecs";
import { PAINT_SPECS_BY_TYPE } from "./paintSpecs";
import type { LayerType, PropertySpec, StyleValue } from "./types";

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
