/**
 * Converts MapLibre Style paint properties to Navara EvaluatedValue.
 */

import { Color as MapLibreColorParser } from "@maplibre/maplibre-gl-style-spec";
import { Color, type GeometryType } from "@navaramap/three";

import type { StyleEngine } from "../engine/StyleEngine";
import {
  isMapLibreColor,
  type EvaluationContext,
  type PropertySpec,
  type StyleLayer,
  type ValueExpression,
} from "../engine/types";

type EvaluatedResult = {
  color?: Color;
  opacity?: number;
  width?: number;
  size?: number;
  height?: number;
  extrudedHeight?: number;
  show?: boolean;
  text?: string;
  image?: string;
};

/**
 * Convert MapLibre color value to Navara Color and extract alpha.
 *
 * Returns object { color, alpha } where:
 * - For MapLibreColor objects: alpha is extracted from the `a` field (or defaults to 1.0)
 * - For CSS color strings: alpha is parsed using MapLibre's Color.parse (supports rgba/hsla/#RRGGBBAA)
 */
export function toNavaraColor(
  value: unknown,
): { color: Color; alpha: number } | undefined {
  try {
    if (typeof value === "string") {
      // CSS color string - use MapLibre's parser to extract both color and alpha
      const maplibreColor = MapLibreColorParser.parse(value);
      if (!maplibreColor) {
        return undefined;
      }
      const color = new Color().setRGB(
        maplibreColor.r,
        maplibreColor.g,
        maplibreColor.b,
      );
      const alpha = maplibreColor.a ?? 1.0;
      return { color, alpha };
    }
    if (isMapLibreColor(value)) {
      // MapLibre Color object with r, g, b, a values (0-1 range)
      const color = new Color().setRGB(value.r, value.g, value.b);
      const alpha = value.a ?? 1.0;
      return { color, alpha };
    }
  } catch {
    // Ignore invalid color values.
  }
  return undefined;
}

/**
 * Apply color and opacity to result object.
 * Combines color alpha with separate opacity value.
 */
function applyColorAndOpacity(
  result: EvaluatedResult,
  colorValue: unknown,
  opacityValue: unknown,
): void {
  const colorResult = toNavaraColor(colorValue);
  if (colorResult) {
    result.color = colorResult.color;
  }

  const colorAlpha = colorResult?.alpha ?? 1.0;
  const opacity =
    typeof opacityValue === "number" && Number.isFinite(opacityValue)
      ? opacityValue
      : undefined;

  if (opacity !== undefined || colorResult) {
    // Clamp final opacity to [0, 1] to prevent rendering artifacts
    const finalOpacity =
      opacity !== undefined ? colorAlpha * opacity : colorAlpha;
    result.opacity = Math.max(0, Math.min(1, finalOpacity));
  }
}

/**
 * Create evaluator functions for a style layer's paint properties.
 *
 * @param styleLayer - MapLibre layer definition
 * @param engine - Style engine for creating expression evaluators
 * @param featureGeometryType - MapLibre/GeoJSON feature geometry type (e.g., "Polygon", "LineString", "Point") for expression evaluation
 * @returns Object with evaluator functions for each paint property
 */
export function createPaintEvaluators(
  styleLayer: StyleLayer,
  engine: StyleEngine,
  featureGeometryType?: string,
) {
  const evaluators: Record<string, (ctx: EvaluationContext) => unknown> = {};

  if (!styleLayer.paint) {
    return evaluators;
  }

  // Create evaluator for each paint property
  for (const [key, value] of Object.entries(styleLayer.paint)) {
    const spec = engine.getPaintSpec(styleLayer.type, key);
    if (!spec) {
      console.warn(`Unknown paint property for ${styleLayer.type}: ${key}`);
      continue;
    }

    // If value is undefined, use default from spec
    const expr = value ?? spec.default;

    try {
      evaluators[key] = engine.createValueFn(expr, spec, featureGeometryType);
    } catch (err) {
      console.error(`Failed to create evaluator for ${key}:`, err);
      // Fallback to spec.default to preserve MapLibre Style Spec behavior
      evaluators[key] = () => spec.default;
    }
  }

  return evaluators;
}

/**
 * Create evaluator functions for a symbol layer's layout properties.
 *
 * Uses the style engine's getLayoutSpec() to retrieve official MapLibre Style Spec
 * defaults and types, preventing drift from hardcoded values.
 *
 * Generates evaluators for important symbol layout properties even when omitted from the style,
 * using spec defaults. This prevents downstream code from needing hardcoded fallbacks.
 *
 * @param styleLayer - MapLibre symbol layer definition
 * @param engine - Style engine for creating expression evaluators
 * @param featureGeometryType - MapLibre/GeoJSON feature geometry type (e.g., "Point") for expression evaluation
 * @returns Object with evaluator functions for each layout property (pre-wrapped with error handling)
 */
export function createLayoutEvaluators(
  styleLayer: StyleLayer,
  engine: StyleEngine,
  featureGeometryType?: string,
) {
  const evaluators: Record<string, (ctx: EvaluationContext) => unknown> = {};

  if (styleLayer.type !== "symbol") {
    return evaluators;
  }

  // Helper to create and wrap an evaluator with try/catch (once, not per-feature)
  const createWrappedEvaluator = (
    key: string,
    expr: ValueExpression,
    spec: PropertySpec,
  ): ((ctx: EvaluationContext) => unknown) => {
    try {
      const evalFn = engine.createValueFn(expr, spec, featureGeometryType);
      // Wrap with try/catch to handle per-feature evaluation errors
      return (ctx: EvaluationContext) => {
        try {
          return evalFn(ctx);
        } catch (_err) {
          // Return undefined on evaluation error (e.g., property missing, type mismatch)
          return undefined;
        }
      };
    } catch (err) {
      console.error(`Failed to create layout evaluator for ${key}:`, err);
      // Return evaluator that always returns spec.default
      return () => spec.default;
    }
  };

  // Curated list of symbol layout properties we support
  // These get evaluators even if not specified in style (using spec.default)
  const supportedProperties = [
    "text-field",
    "text-size",
    "text-font",
    "icon-image",
    "icon-size",
    "text-anchor",
    "icon-anchor",
    "text-offset",
    "icon-offset",
  ];

  for (const key of supportedProperties) {
    const spec = engine.getLayoutSpec(styleLayer.type, key);
    if (!spec) {
      // Property not defined in spec for this layer type - skip
      continue;
    }

    // Get value from style, or use spec default if omitted
    const styleValue = styleLayer.layout?.[key];
    const expr = styleValue ?? spec.default;

    // For optional properties (e.g., icon-image), spec.default can be undefined
    // Skip compilation and return a constant evaluator to avoid logging spurious errors
    if (expr === undefined || expr === null) {
      evaluators[key] = () => spec.default;
      continue;
    }

    evaluators[key] = createWrappedEvaluator(
      key,
      expr as ValueExpression,
      spec,
    );
  }

  // Handle any additional layout properties specified in style but not in our curated list
  if (styleLayer.layout) {
    for (const [key, value] of Object.entries(styleLayer.layout)) {
      if (evaluators[key]) {
        continue; // Already processed
      }

      const spec = engine.getLayoutSpec(styleLayer.type, key);
      if (!spec) {
        console.warn(`Unknown layout property for ${styleLayer.type}: ${key}`);
        continue;
      }

      const expr = value ?? spec.default;

      // For optional properties, spec.default can be undefined
      // Skip compilation and return a constant evaluator to avoid logging spurious errors
      if (expr === undefined || expr === null) {
        evaluators[key] = () => spec.default;
        continue;
      }

      evaluators[key] = createWrappedEvaluator(
        key,
        expr as ValueExpression,
        spec,
      );
    }
  }

  return evaluators;
}

/**
 * Process fill layer properties.
 */
function processFillLayer(
  result: EvaluatedResult,
  paintValues: Record<string, unknown>,
): void {
  applyColorAndOpacity(
    result,
    paintValues["fill-color"],
    paintValues["fill-opacity"],
  );
}

/**
 * Process fill-extrusion layer properties.
 *
 * MapLibre semantics:
 * - fill-extrusion-base: Absolute height of the bottom (default 0)
 * - fill-extrusion-height: Absolute height of the top (default 0)
 *
 * Navara semantics:
 * - height: Base height where the feature sits
 * - extrudedHeight: Extrusion delta/thickness (how much to extrude upward)
 *
 * Conversion: extrudedHeight = fill-extrusion-height - fill-extrusion-base
 */
function processFillExtrusionLayer(
  result: EvaluatedResult,
  paintValues: Record<string, unknown>,
): void {
  applyColorAndOpacity(
    result,
    paintValues["fill-extrusion-color"] ?? paintValues["fill-color"],
    paintValues["fill-extrusion-opacity"] ?? paintValues["fill-opacity"],
  );

  // Extract base and height values
  const fillExtrusionBase = paintValues["fill-extrusion-base"];
  const fillExtrusionHeight = paintValues["fill-extrusion-height"];

  const base =
    typeof fillExtrusionBase === "number" && Number.isFinite(fillExtrusionBase)
      ? fillExtrusionBase
      : 0; // MapLibre default

  const top =
    typeof fillExtrusionHeight === "number" &&
    Number.isFinite(fillExtrusionHeight)
      ? fillExtrusionHeight
      : 0; // MapLibre default

  // Set base height
  result.height = base;

  // Calculate extrusion delta (clamped at 0 to avoid negative extrusion)
  const extrusionDelta = Math.max(0, top - base);
  if (extrusionDelta > 0) {
    result.extrudedHeight = extrusionDelta;
  }
}

/**
 * Process line layer properties.
 */
function processLineLayer(
  result: EvaluatedResult,
  paintValues: Record<string, unknown>,
): void {
  applyColorAndOpacity(
    result,
    paintValues["line-color"],
    paintValues["line-opacity"],
  );

  // Handle line width
  const lineWidth = paintValues["line-width"];
  if (typeof lineWidth === "number" && Number.isFinite(lineWidth)) {
    result.width = lineWidth;
  }
}

/**
 * Process circle layer properties.
 */
function processCircleLayer(
  result: EvaluatedResult,
  paintValues: Record<string, unknown>,
): void {
  applyColorAndOpacity(
    result,
    paintValues["circle-color"],
    paintValues["circle-opacity"],
  );

  // Handle circle radius
  const circleRadius = paintValues["circle-radius"];
  if (typeof circleRadius === "number" && Number.isFinite(circleRadius)) {
    result.size = circleRadius;
  }
}

/**
 * Extract string value from MapLibre's ResolvedImage type.
 * JsStyleEngine returns ResolvedImage objects, RustStyleEngine returns strings directly.
 */
function extractImageName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  // MapLibre ResolvedImage has a 'name' property
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

/**
 * Extract string value from MapLibre's Formatted type.
 * JsStyleEngine returns Formatted objects, RustStyleEngine returns strings directly.
 */
function extractFormattedText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  // MapLibre Formatted has a toString() method
  if (value && typeof value === "object" && "toString" in value) {
    const toString = (value as { toString: unknown }).toString;
    if (typeof toString === "function") {
      return toString.call(value);
    }
  }
  return undefined;
}

/**
 * Process symbol layer properties.
 *
 * IMPORTANT: Symbol layers require an explicit meshGeomType ("billboard" or "text")
 * to avoid ambiguity when both icon and text properties exist.
 * When meshGeomType is undefined, we cannot safely determine which style to apply,
 * as shared fields (color, opacity, size) would overwrite each other.
 * Note: layoutValues should contain evaluated values for all critical properties
 * (text-size, icon-size, etc.) with spec defaults, provided by createLayoutEvaluators.
 */
function processSymbolLayer(
  result: EvaluatedResult,
  paintValues: Record<string, unknown>,
  layoutValues: Record<string, unknown> | undefined,
  meshGeomType: GeometryType | undefined,
  layerId: string,
  warnedLayers?: Set<string>, // Set to track layers that have already warned (prevents log spam)
): void {
  // Determine what this specific feature has based on evaluated layout values
  // Extract string values from MapLibre internal types (ResolvedImage, Formatted)
  const iconImageRaw = layoutValues?.["icon-image"];
  const textFieldRaw = layoutValues?.["text-field"];
  const iconImage = extractImageName(iconImageRaw);
  const textField = extractFormattedText(textFieldRaw);
  const hasIcon = typeof iconImage === "string" && iconImage;
  const hasText = typeof textField === "string" && textField;

  // Validate meshGeomType is one of the expected symbol types
  // Symbol layers MUST have a valid meshGeomType to avoid ambiguous evaluation
  if (meshGeomType !== "billboard" && meshGeomType !== "text") {
    // Warn once per layer to avoid log spam when evaluating thousands of features
    if (warnedLayers && !warnedLayers.has(layerId)) {
      warnedLayers.add(layerId);
      const reason =
        meshGeomType === undefined
          ? "missing meshGeomType"
          : `invalid meshGeomType "${meshGeomType}"`;
      console.warn(
        `Symbol layer "${layerId}": ${reason}. Expected "billboard" or "text" from mesh.getGeometryType(). Skipping symbol evaluation (falling back to layer defaults).`,
      );
    }
    return;
  }

  // Process icon properties for billboard geometry
  if (meshGeomType === "billboard" && hasIcon) {
    result.image = iconImage;

    applyColorAndOpacity(
      result,
      paintValues["icon-color"],
      paintValues["icon-opacity"],
    );

    // Handle icon-size from layout
    // Note: createLayoutEvaluators ensures icon-size is always present (using spec.default = 1)
    // The ?? 1 fallback is defensive and should rarely trigger
    const iconSize = layoutValues?.["icon-size"] ?? 1;
    if (typeof iconSize === "number" && Number.isFinite(iconSize)) {
      result.size = iconSize;
    }
  }

  // Process text properties for text geometry
  if (meshGeomType === "text") {
    if (hasText) {
      result.text = textField;

      applyColorAndOpacity(
        result,
        paintValues["text-color"],
        paintValues["text-opacity"],
      );

      // Handle text-size from layout
      // Note: createLayoutEvaluators ensures text-size is always present (using spec.default = 16)
      // The ?? 16 fallback is defensive and should rarely trigger
      const textSize = layoutValues?.["text-size"] ?? 16;
      if (typeof textSize === "number" && Number.isFinite(textSize)) {
        result.size = textSize;
      }
    } else {
      // Hide text features with empty text-field (e.g., from zoom-based step expressions)
      result.show = false;
    }
  }
}

/**
 * Convert evaluated paint values to Navara's EvaluatedValue format.
 *
 * @param styleLayer - MapLibre layer definition
 * @param paintValues - Evaluated paint property values
 * @param layoutValues - Evaluated layout property values (for symbol layers)
 * @param meshGeomType - Mesh geometry type (e.g., "billboard", "text"). Not GeoJSON geometry type.
 * @param warnedLayers - Set to track layers that have warned (prevents log spam, optional)
 * @returns Navara EvaluatedValue object
 */
export function toEvaluatedValue(
  styleLayer: StyleLayer,
  paintValues: Record<string, unknown>,
  layoutValues?: Record<string, unknown>,
  meshGeomType?: GeometryType,
  warnedLayers?: Set<string>,
): EvaluatedResult {
  const result: EvaluatedResult = {};

  // Map paint properties to Navara properties based on layer type
  switch (styleLayer.type) {
    case "fill":
      processFillLayer(result, paintValues);
      break;
    case "fill-extrusion":
      processFillExtrusionLayer(result, paintValues);
      break;
    case "line":
      processLineLayer(result, paintValues);
      break;
    case "circle":
      processCircleLayer(result, paintValues);
      break;
    case "symbol":
      processSymbolLayer(
        result,
        paintValues,
        layoutValues,
        meshGeomType,
        styleLayer.id,
        warnedLayers,
      );
      break;
  }

  // Only set show to true if not already set (e.g., by processSymbolLayer for empty text)
  if (result.show === undefined) {
    result.show = true;
  }

  return result;
}
