import { describe, it, expect } from "vitest";

import { JsStyleEngine } from "./JsStyleEngine";

describe("JsStyleEngine", () => {
  const engine = new JsStyleEngine();

  describe("createFilter", () => {
    it("should create filter that returns true for all features when no filter", () => {
      // Empty array means no filter (all features pass)
      const filter = engine.createFilter([], "fill", "Polygon");

      expect(filter({ properties: { type: "park" } })).toBe(true);
      expect(filter({ properties: { type: "water" } })).toBe(true);
    });

    it("should create filter for basic expression", () => {
      const filter = engine.createFilter(
        ["==", ["get", "type"], "park"],
        "fill",
        "Polygon",
      );

      expect(filter({ properties: { type: "park" } })).toBe(true);
      expect(filter({ properties: { type: "water" } })).toBe(false);
    });
  });

  describe("createValueFn", () => {
    it("should optimize constant number values", () => {
      const spec = { type: "number" as const, default: 0 };
      const valueFn = engine.createValueFn(42, spec, "Polygon");

      expect(valueFn({ properties: {} })).toBe(42);
    });

    it("should optimize constant boolean values", () => {
      const spec = { type: "boolean" as const, default: false };
      const valueFn = engine.createValueFn(true, spec, "Polygon");

      expect(valueFn({ properties: {} })).toBe(true);
    });

    it("should optimize constant string values (non-color)", () => {
      const spec = { type: "string" as const, default: "" };
      const valueFn = engine.createValueFn("test-value", spec, "Polygon");

      expect(valueFn({ properties: {} })).toBe("test-value");
    });

    it("should handle literal array values", () => {
      const spec = { type: "array" as const, default: [] };
      const valueFn = engine.createValueFn([1, 2, 3], spec, "Polygon");

      expect(valueFn({ properties: {} })).toEqual([1, 2, 3]);
    });

    it("should treat font arrays as literals", () => {
      const spec = { type: "array" as const, default: [] };
      const valueFn = engine.createValueFn(
        ["/fonts/lineseedjp/LINESeedJP-Bold.ttf"],
        spec,
        "Point",
      );

      expect(valueFn({ properties: {} })).toEqual([
        "/fonts/lineseedjp/LINESeedJP-Bold.ttf",
      ]);
    });

    it("should create function for basic expression", () => {
      const spec = { type: "string" as const, default: "" };
      const valueFn = engine.createValueFn(["get", "name"], spec, "Polygon");

      expect(valueFn({ properties: { name: "test" } })).toBe("test");
      expect(valueFn({ properties: {} })).toBe("");
    });

    it("should evaluate a padding expression to [top, right, bottom, left]", () => {
      const spec = { type: "padding" as const, default: [2] };
      const valueFn = engine.createValueFn(["get", "pad"], spec, "Point");

      expect(valueFn({ properties: { pad: [1, 4] } })).toEqual([1, 4, 1, 4]);
    });

    it("should throw error for invalid expression", () => {
      const spec = { type: "color" as const, default: "#000000" };

      expect(() => {
        engine.createValueFn(["invalid-op", "test"], spec, "Polygon");
      }).toThrow("Failed to create expression");
    });
  });

  describe("getPaintSpec", () => {
    it("should return spec for valid property", () => {
      const spec = engine.getPaintSpec("fill", "fill-color");

      expect(spec).toBeDefined();
      expect(spec?.type).toBe("color");
    });

    it("should return undefined for unknown property", () => {
      const spec = engine.getPaintSpec("fill", "unknown-property");

      expect(spec).toBeUndefined();
    });
  });

  describe("getLayoutSpec", () => {
    it("should return spec for valid property", () => {
      const spec = engine.getLayoutSpec("symbol", "text-field");

      expect(spec).toBeDefined();
      expect(spec?.type).toBe("formatted");
    });

    it("should return undefined for unknown property", () => {
      const spec = engine.getLayoutSpec("symbol", "unknown-property");

      expect(spec).toBeUndefined();
    });
  });
});
