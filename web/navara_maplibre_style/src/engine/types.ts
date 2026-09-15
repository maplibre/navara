/**
 * Core types for MapLibre Style engine abstraction.
 * These types define the interface between the plugin and the style engine,
 * allowing easy swap between JS and future Rust/WASM implementations.
 */

import type {
  GeoJSONSourceSpecification,
  VectorSourceSpecification,
  RasterSourceSpecification,
  RasterDEMSourceSpecification,
  TerrainSpecification,
} from "@maplibre/maplibre-gl-style-spec";

/**
 * Simplified MapLibre Style specification.
 * For the PoC, we only support a subset of the full spec.
 */
export type ParsedStyle = {
  version: 8;
  sources: Record<string, StyleSource>;
  layers: StyleLayer[];
  terrain?: TerrainSpecification;
  glyphs?: string; // URL template for font glyphs (not supported, use fontFamily option instead)
};

/**
 * Source types from MapLibre Style Spec.
 */
export type StyleSource =
  VectorSource | GeoJSONSource | RasterSource | RasterDemSource;

/**
 * GeoJSON source from MapLibre Style Spec.
 * @see https://maplibre.org/maplibre-style-spec/sources/#geojson
 */
export type GeoJSONSource = GeoJSONSourceSpecification;

/**
 * Vector tile source from MapLibre Style Spec.
 * @see https://maplibre.org/maplibre-style-spec/sources/#vector
 */
export type VectorSource = VectorSourceSpecification;

/**
 * Raster tile source from MapLibre Style Spec.
 * @see https://maplibre.org/maplibre-style-spec/sources/#raster
 */
export type RasterSource = RasterSourceSpecification;

/**
 * Raster DEM source from MapLibre Style Spec (for terrain/hillshade).
 * @see https://maplibre.org/maplibre-style-spec/sources/#raster-dem
 */
export type RasterDemSource = Omit<RasterDEMSourceSpecification, "encoding"> & {
  encoding?: "terrarium" | "mapbox" | "custom";
};

/**
 * Layer types supported: fill, fill-extrusion, line, circle, symbol, raster, hillshade, background.
 *
 * Note: We define our own simplified layer types instead of using the official MapLibre
 * LayerSpecification types because:
 * 1. Official types use complex DataDrivenPropertyValueSpecification wrappers that make
 *    property access difficult (requires type narrowing for every access)
 * 2. We need a simpler interface for our style engine abstraction
 * 3. Our types are compatible with MapLibre at runtime, just more lenient at compile time
 */
export type StyleLayer =
  | FillLayer
  | FillExtrusionLayer
  | LineLayer
  | CircleLayer
  | SymbolLayer
  | RasterLayer
  | HillshadeLayer
  | BackgroundLayer;

export type LayerType =
  | "fill"
  | "fill-extrusion"
  | "line"
  | "circle"
  | "symbol"
  | "raster"
  | "hillshade"
  | "background";

export type BaseLayer = {
  id: string;
  type: LayerType;
  source: string;
  "source-layer"?: string;
  minzoom?: number;
  maxzoom?: number;
  filter?: FilterExpression;
  layout?: Record<string, unknown>;
};

export type FillLayer = {
  type: "fill";
  paint?: FillPaint;
} & BaseLayer;

export type FillPaint = {
  "fill-color"?: ValueExpression;
  "fill-opacity"?: ValueExpression;
  "fill-outline-color"?: ValueExpression;
};

export type FillExtrusionLayer = {
  type: "fill-extrusion";
  paint?: FillExtrusionPaint;
} & BaseLayer;

export type FillExtrusionPaint = {
  "fill-extrusion-color"?: ValueExpression;
  "fill-extrusion-opacity"?: ValueExpression;
  "fill-extrusion-base"?: ValueExpression;
  "fill-extrusion-height"?: ValueExpression;
};

export type LineLayer = {
  type: "line";
  paint?: LinePaint;
} & BaseLayer;

export type LinePaint = {
  "line-color"?: ValueExpression;
  "line-width"?: ValueExpression;
  "line-opacity"?: ValueExpression;
};

export type CircleLayer = {
  type: "circle";
  paint?: CirclePaint;
} & BaseLayer;

export type CirclePaint = {
  "circle-color"?: ValueExpression;
  "circle-radius"?: ValueExpression;
  "circle-opacity"?: ValueExpression;
};

export type RasterLayer = {
  type: "raster";
  paint?: RasterPaint;
} & BaseLayer;

export type RasterPaint = {
  "raster-opacity"?: ValueExpression;
};

export type HillshadeLayer = {
  type: "hillshade";
  paint?: HillshadePaint;
} & BaseLayer;

export type HillshadePaint = {
  "hillshade-exaggeration"?: ValueExpression;
};

export type BackgroundLayer = {
  id: string;
  type: "background";
  paint?: BackgroundPaint;
  minzoom?: number;
  maxzoom?: number;
  layout?: Record<string, unknown>;
};

export type BackgroundPaint = {
  "background-color"?: ValueExpression;
  "background-opacity"?: ValueExpression;
};

export type SymbolLayer = {
  type: "symbol";
  layout?: SymbolLayout;
  paint?: SymbolPaint;
} & BaseLayer;

export type SymbolLayout = {
  "icon-image"?: ValueExpression;
  "icon-size"?: ValueExpression;
  "icon-offset"?: ValueExpression;
  "icon-anchor"?: ValueExpression;
  "text-field"?: ValueExpression;
  "text-size"?: ValueExpression;
  "text-offset"?: ValueExpression;
  "text-anchor"?: ValueExpression;
  "text-font"?: ValueExpression;
};

export type SymbolPaint = {
  "icon-color"?: ValueExpression;
  "icon-opacity"?: ValueExpression;
  "text-color"?: ValueExpression;
  "text-opacity"?: ValueExpression;
  "text-halo-color"?: ValueExpression;
  "text-halo-width"?: ValueExpression;
};

/**
 * Expression types from MapLibre Style spec.
 * These can be literals, property references, or complex expressions.
 */
export type ValueExpression = string | number | boolean | unknown[];
export type FilterExpression = unknown[];

/**
 * Context for evaluating style expressions.
 *
 * Includes zoom level for zoom-based expressions (e.g., ["step", ["zoom"], ...]).
 * Currently uses camera zoom for simplicity, though MapLibre traditionally uses
 * per-tile zoom levels. This means all features evaluate expressions at the same
 * zoom regardless of their source tile's zoom level.
 */
export type EvaluationContext = {
  properties: Record<string, unknown> | undefined;
  zoom?: number;
};

/**
 * Context for filter evaluation (subset of EvaluationContext).
 */
export type FeatureContext = {
  properties: Record<string, unknown> | undefined;
  zoom?: number;
};

/**
 * MapLibre Color object format (consistent with @maplibre/maplibre-gl-style-spec).
 * Alpha channel is optional (defaults to 1 when missing).
 */
export type MapLibreColor = {
  r: number;
  g: number;
  b: number;
  a?: number;
};

/**
 * Type guard to check if a value is a valid MapLibre Color object.
 * Validates that r, g, b are finite numbers and a (if present) is also finite.
 */
export function isMapLibreColor(value: unknown): value is MapLibreColor {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.r === "number" &&
    typeof obj.g === "number" &&
    typeof obj.b === "number" &&
    Number.isFinite(obj.r) &&
    Number.isFinite(obj.g) &&
    Number.isFinite(obj.b) &&
    (obj.a === undefined ||
      (typeof obj.a === "number" && Number.isFinite(obj.a)))
  );
}

/**
 * Possible return types from style expressions.
 *
 * Common array-valued properties in MapLibre Style Spec:
 * - line-dasharray: number[]
 * - text-offset, icon-offset, translate: number[] (typically 2 elements)
 */
export type StyleValue =
  | number
  | string
  | boolean
  | MapLibreColor
  | [number, number, number, number] // Legacy color array format
  | number[]; // Array-valued properties (dasharray, offset, translate, etc.)

/**
 * Property specification for type checking and defaults.
 * This matches the structure from @maplibre/maplibre-gl-style-spec.
 */
export type PropertySpec = {
  type:
    | "color"
    | "number"
    | "boolean"
    | "string"
    | "array"
    | "formatted"
    | "resolvedImage";
  default?: unknown;
  minimum?: number;
  maximum?: number;
  expression?: {
    interpolated: boolean;
    parameters: string[];
  };
};
