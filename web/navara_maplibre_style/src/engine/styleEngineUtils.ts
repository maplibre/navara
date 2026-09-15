/**
 * Shared utilities for StyleEngine implementations.
 */

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
 * For unknown types, logs an error and returns an empty string as a safe fallback.
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

/**
 * Check if an array expression looks like a literal value rather than an expression.
 *
 * Literal arrays include:
 * - Font paths: ["/fonts/custom.ttf"]
 * - Font names with spaces: ["Open Sans Regular"]
 * - Font names starting with uppercase: ["Roboto"]
 *
 * Expression arrays have lowercase operators as first element: ["get", "prop"]
 */
export function isLiteralArray(expr: unknown): boolean {
  if (!Array.isArray(expr) || expr.length === 0) {
    return false;
  }

  const firstElement = expr[0];
  if (typeof firstElement !== "string") {
    return false;
  }

  // Check if it looks like a literal value rather than an expression operator:
  // - Starts with "/" (path)
  // - Contains spaces (font names like "Open Sans Regular")
  // - Starts with uppercase (font names)
  // But NOT if it's a known expression operator (they're lowercase, no spaces, no slashes)
  return (
    firstElement.startsWith("/") ||
    firstElement.includes(" ") ||
    /^[A-Z]/.test(firstElement)
  );
}
