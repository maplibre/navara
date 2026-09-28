/**
 * Check if an expression uses the zoom operator.
 * Recursively searches for ["zoom"] in the expression tree.
 * Also detects legacy function objects with stops (zoom-dependent).
 *
 * Correctly handles three types of legacy function objects:
 * - Zoom functions: { stops: [[zoom, value], ...] } → zoom-dependent
 * - Property-only functions: { property: "x", stops: [[value, result], ...] } → NOT zoom-dependent
 * - Composite functions: { property: "x", stops: [[{zoom: 5, value: 0}, result], ...] } → zoom-dependent
 */
export function expressionUsesZoom(expr: unknown): boolean {
  // Check for legacy function objects with stops
  if (expr && typeof expr === "object" && !Array.isArray(expr)) {
    const obj = expr as Record<string, unknown>;
    if ("stops" in obj && Array.isArray(obj.stops)) {
      // Only treat as property/composite function if property is a non-empty string
      // Invalid property values (undefined, null, empty string, non-string) mean it's a zoom function
      if (
        "property" in obj &&
        typeof obj.property === "string" &&
        obj.property.length > 0
      ) {
        // Check if this is a composite function (zoom-and-property)
        // Composite functions have stops like [[{zoom: 5, value: 0}, result], ...]
        // Property-only functions have stops like [[value, result], ...]
        // Iterate over all stops for robust detection
        for (const stop of obj.stops) {
          if (Array.isArray(stop) && stop.length > 0) {
            const stopInput = stop[0];
            // If any stop input is an object with zoom field, it's composite (zoom-dependent)
            if (
              stopInput &&
              typeof stopInput === "object" &&
              "zoom" in stopInput
            ) {
              return true;
            }
          }
        }
        // Property-only function (not zoom-dependent)
        return false;
      }
      // No valid property field: this is a zoom function
      return true;
    }
    // Check nested objects recursively
    for (const value of Object.values(obj)) {
      if (expressionUsesZoom(value)) {
        return true;
      }
    }
    return false;
  }

  if (!Array.isArray(expr)) {
    return false;
  }

  // Check if this is a zoom expression
  if (expr[0] === "zoom") {
    return true;
  }

  // Recursively check nested expressions
  for (const item of expr) {
    if (expressionUsesZoom(item)) {
      return true;
    }
  }

  return false;
}
