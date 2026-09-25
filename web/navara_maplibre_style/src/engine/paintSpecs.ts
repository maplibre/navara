/**
 * Paint property specifications from MapLibre Style Spec.
 * Separated from types.ts to avoid pulling the full style-spec into bundles
 * when consumers only need type definitions or utility functions.
 */

import { v8 } from "@maplibre/maplibre-gl-style-spec";

/**
 * MapLibre's official paint property specifications by layer type.
 * Using the official specs ensures compatibility with the MapLibre Style spec.
 */
export const PAINT_SPECS_BY_TYPE = {
  fill: v8.paint_fill,
  "fill-extrusion": v8["paint_fill-extrusion"],
  line: v8.paint_line,
  circle: v8.paint_circle,
  symbol: v8.paint_symbol,
  raster: v8.paint_raster,
  hillshade: v8.paint_hillshade,
  background: v8.paint_background,
};

/**
 * Validate that all paint specs are loaded correctly.
 * Used in tests to catch breaking changes in @maplibre/maplibre-gl-style-spec.
 *
 * Note: This is NOT called at module load time to avoid breaking production apps
 * if the spec structure changes. Instead, getPaintSpec() returns undefined for
 * missing specs, allowing graceful degradation.
 */
export function validatePaintSpecs(): void {
  const missingSpecs: string[] = [];

  for (const [layerType, spec] of Object.entries(PAINT_SPECS_BY_TYPE)) {
    if (!spec || typeof spec !== "object") {
      missingSpecs.push(layerType);
    }
  }

  if (missingSpecs.length > 0) {
    throw new Error(
      `Paint specs missing for layer types: ${missingSpecs.join(", ")}. ` +
        `This may indicate a breaking change in @maplibre/maplibre-gl-style-spec. ` +
        `Please check the v8 spec object structure.`,
    );
  }
}
