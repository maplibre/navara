/**
 * Rust/WASM implementation of StyleEngine using maplibre-expr.
 *
 * This implementation moves expression evaluation from JavaScript to Rust,
 * providing better performance and type safety through the maplibre-expr crate.
 */

import { CompiledExpression, CompiledFilter } from "@navaramap/engine";

import type { StyleEngine } from "./StyleEngine";
import {
  getLayoutSpec,
  getPaintSpec,
  getTypeDefault,
  isLiteralArray,
} from "./styleEngineUtils";
import type {
  EvaluationContext,
  FeatureContext,
  FilterExpression,
  LayerType,
  PropertySpec,
  StyleValue,
  ValueExpression,
} from "./types";

export class RustStyleEngine implements StyleEngine {
  createFilter(
    expr: FilterExpression,
    _layerType: LayerType,
    featureGeometryType: string,
  ): (feature: FeatureContext) => boolean {
    // Match JsStyleEngine behavior: empty filter array means "no filter".
    if (Array.isArray(expr) && expr.length === 0) {
      return () => true;
    }
    // Compile filter in WASM
    const compiled = new CompiledFilter(expr);

    // Return evaluation function
    return (ctx: FeatureContext) => {
      try {
        const result = compiled.test(
          ctx.properties ?? {},
          ctx.zoom ?? 0, // Use tile zoom if available, otherwise 0 for non-tiled features
          featureGeometryType, // Pass geometry type for ["geometry-type"] filters
          ctx.featureId, // ["id"] / legacy $id
        );
        return result;
      } catch (_err) {
        // Runtime evaluation error (e.g., invalid property value, type mismatch)
        // Hide this feature (return false) rather than breaking the entire layer
        return false;
      }
    };
  }

  createValueFn<T extends StyleValue>(
    expr: ValueExpression,
    spec: PropertySpec,
    featureGeometryType = "Point",
  ): (ctx: EvaluationContext) => T {
    // Note: migrate() has already converted legacy functions and tokens to modern expressions
    // in validateAndMigrateStyle(), so we don't need to handle them here.

    // Handle constant values directly (optimization).
    // For color strings, still compile via WASM so maplibre-expr can validate/coerce (and preserve alpha).
    if (typeof expr === "number" || typeof expr === "boolean") {
      const constantValue = expr as T;
      return () => constantValue;
    }

    if (typeof expr === "string") {
      if (spec.type === "color") {
        // Color strings must be compiled for validation
        // Fall through to compile
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

    // Compile expression in WASM with type checking
    let compiled: CompiledExpression;
    // Undefined when the properties read can't be named statically (a computed
    // get/has key, or `["properties"]` other than as a literal-key get/has object).
    let requiredProps: string[] | undefined;
    try {
      // Pass expected type for validation (matches JsStyleEngine behavior)
      compiled = new CompiledExpression(expr, spec.type);
      requiredProps = compiled.getRequiredProperties() as string[] | undefined;
    } catch (e) {
      // If compilation fails and this looks like a literal array (paths, font names, etc.),
      // treat it as a constant value instead of throwing.
      // This handles cases like text-font: ["/fonts/custom.ttf"] or ["Font Name"] which are valid literals.
      if (isLiteralArray(expr, spec)) {
        const constantValue = expr as unknown as T;
        return () => constantValue;
      }

      // Let the caller add property/layer context (and decide the fallback).
      throw e instanceof Error ? e : new Error(String(e));
    }

    // Return evaluation function with optimized property passing
    return (ctx: EvaluationContext) => {
      // Filter properties to only required ones to reduce serialization overhead
      let propsToPass: Record<string, unknown>;
      if (requiredProps === undefined) {
        propsToPass = ctx.properties ?? {};
      } else {
        // No prototype, so a property named `__proto__` is kept as data.
        propsToPass = Object.create(null) as Record<string, unknown>;
        if (ctx.properties) {
          for (const prop of requiredProps) {
            if (Object.prototype.hasOwnProperty.call(ctx.properties, prop)) {
              propsToPass[prop] = ctx.properties[prop];
            }
          }
        }
      }

      try {
        const result = compiled.evaluate(
          propsToPass,
          ctx.zoom ?? 0, // Use tile zoom if available, otherwise 0 for non-tiled features
          featureGeometryType, // Pass geometry type for expressions that need it
          ctx.elevation, // ["elevation"] (color-relief-color only)
          ctx.featureId, // ["id"]
        );

        if (result == null) {
          return (spec.default ?? getTypeDefault(spec.type)) as T;
        }

        // Return result as-is; maplibre-expr handles type conversion
        return result as T;
      } catch (e) {
        console.error("Expression evaluation error:", e);
        // Return default on evaluation error
        return (spec.default ?? getTypeDefault(spec.type)) as T;
      }
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
