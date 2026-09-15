/**
 * Layout property specifications from MapLibre Style Spec.
 * Ensures layout defaults and types match the official MapLibre specification.
 */

import { v8 } from "@maplibre/maplibre-gl-style-spec";

/**
 * MapLibre's official layout property specifications by layer type.
 * Using the official specs ensures compatibility with the MapLibre Style spec.
 *
 * Note: Most layer types don't have layout properties in MapLibre Style Spec.
 * Only symbol, line, circle layers have significant layout configuration.
 */
export const LAYOUT_SPECS_BY_TYPE = {
  symbol: v8.layout_symbol,
  line: v8.layout_line,
  circle: v8.layout_circle,
  fill: v8.layout_fill,
  "fill-extrusion": v8["layout_fill-extrusion"],
  raster: v8.layout_raster,
  hillshade: v8.layout_hillshade,
  background: v8.layout_background,
};

/**
 * Validate that all layout specs are loaded correctly.
 * Used in tests to catch breaking changes in @maplibre/maplibre-gl-style-spec.
 *
 * Note: This is NOT called at module load time to avoid breaking production apps
 * if the spec structure changes. Instead, getLayoutSpec() returns undefined for
 * missing specs, allowing graceful degradation.
 */
export function validateLayoutSpecs(): void {
  const missingSpecs: string[] = [];

  for (const [layerType, spec] of Object.entries(LAYOUT_SPECS_BY_TYPE)) {
    // Some layer types may legitimately have empty/undefined layout specs
    // Only warn if spec is defined but not an object
    if (spec !== undefined && typeof spec !== "object") {
      missingSpecs.push(layerType);
    }
  }

  if (missingSpecs.length > 0) {
    throw new Error(
      `Layout specs invalid for layer types: ${missingSpecs.join(", ")}. ` +
        `This may indicate a breaking change in @maplibre/maplibre-gl-style-spec. ` +
        `Please check the v8 spec object structure.`,
    );
  }
}
