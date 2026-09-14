/**
 * JavaScript implementation of StyleEngine using @maplibre/maplibre-gl-style-spec.
 *
 */

import {
  createExpression,
  featureFilter,
  validateStyleMin,
  migrate,
} from "@maplibre/maplibre-gl-style-spec";
import type {
  FilterSpecification,
  StyleSpecification,
  StylePropertySpecification,
} from "@maplibre/maplibre-gl-style-spec";

import type { StyleEngine } from "./StyleEngine";
import {
  getLayoutSpec,
  getPaintSpec,
  isLiteralArray,
} from "./styleEngineUtils";
import type {
  EvaluationContext,
  FeatureContext,
  FilterExpression,
  LayerType,
  ParsedStyle,
  PropertySpec,
  StyleValue,
  ValueExpression,
} from "./types";

export class JsStyleEngine implements StyleEngine {
  async parseStyle(raw: unknown): Promise<ParsedStyle> {
    // Migrate legacy style features (functions, tokens) to modern expressions
    const migrated = migrate(raw as StyleSpecification);

    // Validate the migrated style
    const errors = validateStyleMin(migrated);

    if (errors && errors.length > 0) {
      const errorMessages = errors.map((e: { message: string }) => e.message);
      throw new Error(`Invalid MapLibre Style: ${errorMessages.join(", ")}`);
    }

    return migrated as ParsedStyle;
  }

  createFilter(
    expr: FilterExpression,
    _layerType: LayerType,
    featureGeometryType: string,
  ): (feature: FeatureContext) => boolean {
    // Since v21 `featureFilter` requires a `rootKey` locating the expression in
    // the style JSON; it is only used to prefix runtime warnings.
    const { filter } = featureFilter(expr as FilterSpecification, "filter");

    return (ctx: FeatureContext) => {
      // Construct a valid GeoJSON Feature for MapLibre's filter evaluator.
      // This ensures filters like ["geometry-type"] work correctly.
      const feature = {
        type: "Feature" as const,
        properties: ctx.properties ?? {},
        geometry: {
          type: featureGeometryType, // e.g., "Point", "Polygon", "LineString"
          coordinates: [], // Empty coordinates - most filters only check properties/type
        },
      };

      // Use tile zoom from context if available, otherwise default to 0 for non-tiled features
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return filter({ zoom: ctx.zoom ?? 0 }, feature as any);
    };
  }

  createValueFn<T extends StyleValue>(
    expr: ValueExpression,
    spec: PropertySpec,
    featureGeometryType = "Point",
  ): (ctx: EvaluationContext) => T {
    // Handle constant values directly (optimization).
    // For color strings, still compile via MapLibre so it can validate/coerce (and preserve alpha).
    if (typeof expr === "number" || typeof expr === "boolean") {
      const constantValue = expr as T;
      return () => constantValue;
    }

    if (typeof expr === "string") {
      if (spec.type === "color") {
        // Color strings must be compiled for validation
        // Fall through to createExpression
      } else {
        // Constant string (tokens already converted by migrate)
        const constantValue = expr as T;
        return () => constantValue;
      }
    }

    // MapLibre allows literal arrays as property values (e.g., [1, 2, 3], ["/fonts/..."]).
    // Only treat as constant if it's empty or doesn't start with a string operator.
    if (
      Array.isArray(expr) &&
      (expr.length === 0 || typeof expr[0] !== "string")
    ) {
      const constantValue = expr as unknown as T;
      return () => constantValue;
    }

    // Since v21 `createExpression` requires a `rootKey` locating the expression
    // in the style JSON; it is only used to prefix runtime warnings.
    const result = createExpression(
      expr,
      "paint",
      spec as StylePropertySpecification,
    );

    if (result.result === "error") {
      // If compilation fails and this looks like a literal array (paths, font names, etc.),
      // treat it as a constant value instead of throwing.
      // This handles cases like text-font: ["/fonts/custom.ttf"] or ["Font Name"] which are valid literals.
      if (isLiteralArray(expr)) {
        const constantValue = expr as unknown as T;
        return () => constantValue;
      }

      const errorMsg = result.value
        .map((e: { message: string }) => e.message)
        .join(", ");
      throw new Error(`Failed to create expression: ${errorMsg}`);
    }

    const expression = result.value;

    return (ctx: EvaluationContext) => {
      // Construct a valid GeoJSON Feature for MapLibre's expression evaluator.
      const feature = {
        type: "Feature" as const,
        properties: ctx.properties ?? {},
        geometry: {
          type: featureGeometryType, // e.g., "Point", "Polygon", "LineString"
          coordinates: [], // Empty coordinates - most expressions only access properties
        },
      };

      // Use tile zoom from context if available (for tiled features like MVT),
      // otherwise default to 0 for non-tiled features (GeoJSON)
      const zoomValue = ctx.zoom ?? 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = expression.evaluate({ zoom: zoomValue }, feature as any);

      return value as T;
    };
  }

  getPaintSpec(
    layerType: LayerType,
    propertyName: string,
  ): PropertySpec | undefined {
    return getPaintSpec(layerType, propertyName);
  }

  getLayoutSpec(
    layerType: LayerType,
    propertyName: string,
  ): PropertySpec | undefined {
    return getLayoutSpec(layerType, propertyName);
  }
}
