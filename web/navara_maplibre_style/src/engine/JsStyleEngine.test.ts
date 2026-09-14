import { describe, it, expect } from "vitest";

import { JsStyleEngine } from "./JsStyleEngine";
import type { LayerType } from "./types";

// Type for MapLibre Color objects (r, g, b in 0-1 range)
type MapLibreColor = {
  r: number;
  g: number;
  b: number;
  a?: number;
};

describe("JsStyleEngine", () => {
  const engine = new JsStyleEngine();

  describe("parseStyle", () => {
    it("should parse valid style", async () => {
      const validStyle = {
        version: 8,
        sources: {
          test: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [],
      };

      const parsed = await engine.parseStyle(validStyle);
      expect(parsed).toHaveProperty("version", 8);
      expect(parsed).toHaveProperty("sources");
      expect(parsed).toHaveProperty("layers");
    });

    it("should migrate legacy styles (version 7 → 8)", async () => {
      const legacyStyle = {
        version: 7,
        sources: {},
        layers: [],
      };

      const parsed = await engine.parseStyle(legacyStyle);
      // migrate() should upgrade version to 8
      expect(parsed.version).toBe(8);
    });

    it("should throw error for missing sources", async () => {
      const invalidStyle = {
        version: 8,
        // Missing sources
        layers: [],
      };

      await expect(engine.parseStyle(invalidStyle)).rejects.toThrow(
        "Invalid MapLibre Style",
      );
    });

    it("should throw error for completely malformed input", async () => {
      const malformedInput = {
        notAStyle: "at all",
        random: { nested: { data: 123 } },
      };

      // migrate() throws raw error for malformed input (not wrapped)
      await expect(engine.parseStyle(malformedInput)).rejects.toThrow();
    });

    it("should throw error for non-object input", async () => {
      // migrate() throws raw error for non-object input (not wrapped)
      await expect(engine.parseStyle("not an object")).rejects.toThrow();
    });
  });

  describe("createFilter", () => {
    it("should create filter that returns true for all features when no filter", () => {
      // Empty array means no filter (all features pass)
      const filter = engine.createFilter([], "fill", "Polygon");

      expect(filter({ properties: { type: "park" } })).toBe(true);
      expect(filter({ properties: { type: "water" } })).toBe(true);
    });

    it("should create filter for equality comparison", () => {
      const filter = engine.createFilter(
        ["==", ["get", "type"], "park"],
        "fill",
        "Polygon",
      );

      expect(filter({ properties: { type: "park" } })).toBe(true);
      expect(filter({ properties: { type: "water" } })).toBe(false);
    });

    it("should create filter for numeric comparison", () => {
      const filter = engine.createFilter(
        [">", ["get", "population"], 1000],
        "fill",
        "Polygon",
      );

      expect(filter({ properties: { population: 2000 } })).toBe(true);
      expect(filter({ properties: { population: 500 } })).toBe(false);
    });

    it("should handle undefined properties", () => {
      const filter = engine.createFilter(
        ["==", ["get", "type"], "park"],
        "fill",
        "Polygon",
      );

      expect(filter({ properties: undefined })).toBe(false);
      expect(filter({ properties: {} })).toBe(false);
    });
  });

  describe("createValueFn", () => {
    it("should create function for constant color value", () => {
      const spec = { type: "color" as const, default: "#000000" };
      const valueFn = engine.createValueFn("#ff0000", spec, "Polygon");

      const result = valueFn({ properties: {} }) as MapLibreColor;
      // MapLibre returns a Color object with r, g, b properties (0-1 range)
      expect(result.r).toBeCloseTo(1, 2);
      expect(result.g).toBeCloseTo(0, 2);
      expect(result.b).toBeCloseTo(0, 2);
    });

    it("should create function for property get expression", () => {
      const spec = { type: "string" as const, default: "" };
      const valueFn = engine.createValueFn(["get", "name"], spec, "Polygon");

      expect(valueFn({ properties: { name: "test" } })).toBe("test");
      // MapLibre returns the default value (empty string) when property is missing
      expect(valueFn({ properties: {} })).toBe("");
    });

    it("should create function for case expression", () => {
      const spec = { type: "color" as const, default: "#000000" };
      const valueFn = engine.createValueFn(
        ["case", ["==", ["get", "type"], "park"], "#00ff00", "#ff0000"],
        spec,
        "Polygon",
      );

      const parkColor = valueFn({
        properties: { type: "park" },
      }) as MapLibreColor;
      expect(parkColor.r).toBeCloseTo(0, 2);
      expect(parkColor.g).toBeCloseTo(1, 2);
      expect(parkColor.b).toBeCloseTo(0, 2);

      const waterColor = valueFn({
        properties: { type: "water" },
      }) as MapLibreColor;
      expect(waterColor.r).toBeCloseTo(1, 2);
      expect(waterColor.g).toBeCloseTo(0, 2);
      expect(waterColor.b).toBeCloseTo(0, 2);
    });

    it("should throw error for invalid expression", () => {
      const spec = { type: "color" as const, default: "#000000" };

      expect(() => {
        engine.createValueFn(["invalid-op", "test"], spec, "Polygon");
      }).toThrow("Failed to create expression");
    });

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

    it("should handle literal array values (number array)", () => {
      const spec = { type: "array" as const, default: [] };
      const valueFn = engine.createValueFn([1, 2, 3], spec, "Polygon");

      expect(valueFn({ properties: {} })).toEqual([1, 2, 3]);
    });

    it("should treat font path arrays as literals", () => {
      const spec = { type: "array" as const, default: [] };
      // Font paths starting with "/" should be treated as literals, not expressions
      const valueFn = engine.createValueFn(
        ["/fonts/lineseedjp/LINESeedJP-Bold.ttf"],
        spec,
        "Point",
      );

      expect(valueFn({ properties: {} })).toEqual([
        "/fonts/lineseedjp/LINESeedJP-Bold.ttf",
      ]);
    });

    it("should treat font name arrays as literals", () => {
      const spec = { type: "array" as const, default: [] };
      // Font names with spaces should be treated as literals
      const valueFn = engine.createValueFn(
        ["Open Sans Regular", "Arial Unicode MS Regular"],
        spec,
        "Point",
      );

      expect(valueFn({ properties: {} })).toEqual([
        "Open Sans Regular",
        "Arial Unicode MS Regular",
      ]);
    });

    it("should treat uppercase font names as literals", () => {
      const spec = { type: "array" as const, default: [] };
      // Font names starting with uppercase should be treated as literals
      const valueFn = engine.createValueFn(["Roboto"], spec, "Point");

      expect(valueFn({ properties: {} })).toEqual(["Roboto"]);
    });
  });

  describe("getPaintSpec", () => {
    it("should return spec for fill-color", () => {
      const spec = engine.getPaintSpec("fill", "fill-color");

      expect(spec).toBeDefined();
      expect(spec?.type).toBe("color");
    });

    it("should return spec for line-width", () => {
      const spec = engine.getPaintSpec("line", "line-width");

      expect(spec).toBeDefined();
      expect(spec?.type).toBe("number");
    });

    it("should return spec for circle-radius", () => {
      const spec = engine.getPaintSpec("circle", "circle-radius");

      expect(spec).toBeDefined();
      expect(spec?.type).toBe("number");
    });

    it("should return undefined for unknown property", () => {
      const spec = engine.getPaintSpec("fill", "unknown-property");

      expect(spec).toBeUndefined();
    });

    it("should return undefined for unsupported layer type", () => {
      // Test with an unsupported layer type to verify graceful handling
      const spec = engine.getPaintSpec(
        "sky" as unknown as LayerType,
        "sky-color",
      );

      expect(spec).toBeUndefined();
    });

    it("should return spec for symbol layer text-color", () => {
      const spec = engine.getPaintSpec("symbol", "text-color");

      expect(spec).toBeDefined();
      expect(spec?.type).toBe("color");
    });

    it("should return spec for symbol layer icon-opacity", () => {
      const spec = engine.getPaintSpec("symbol", "icon-opacity");

      expect(spec).toBeDefined();
      expect(spec?.type).toBe("number");
    });

    it("should return spec for symbol layer icon-color", () => {
      const spec = engine.getPaintSpec("symbol", "icon-color");

      expect(spec).toBeDefined();
      expect(spec?.type).toBe("color");
    });

    it("should return spec for symbol layer text-opacity", () => {
      const spec = engine.getPaintSpec("symbol", "text-opacity");

      expect(spec).toBeDefined();
      expect(spec?.type).toBe("number");
    });
  });

  describe("createValueFn for symbol properties", () => {
    it("should evaluate icon-image expression", () => {
      const spec = { type: "string" as const, default: "" };
      const valueFn = engine.createValueFn(["get", "icon"], spec, "Point");

      expect(valueFn({ properties: { icon: "/icons/marker.svg" } })).toBe(
        "/icons/marker.svg",
      );
    });

    it("should evaluate text-field expression", () => {
      const spec = { type: "string" as const, default: "" };
      const valueFn = engine.createValueFn(["get", "name"], spec, "Point");

      expect(valueFn({ properties: { name: "Tokyo" } })).toBe("Tokyo");
    });

    it("should evaluate icon-size expression", () => {
      const spec = { type: "number" as const, default: 1 };
      const valueFn = engine.createValueFn(["get", "iconSize"], spec, "Point");

      expect(valueFn({ properties: { iconSize: 2.5 } })).toBe(2.5);
    });

    it("should evaluate text-size expression", () => {
      const spec = { type: "number" as const, default: 16 };
      const valueFn = engine.createValueFn(["get", "textSize"], spec, "Point");

      expect(valueFn({ properties: { textSize: 24 } })).toBe(24);
    });

    it("should evaluate dynamic icon-color", () => {
      const spec = { type: "color" as const, default: "#000000" };
      const valueFn = engine.createValueFn(["get", "iconColor"], spec, "Point");

      const result = valueFn({
        properties: { iconColor: "#00ff00" },
      }) as MapLibreColor;
      expect(result.r).toBeCloseTo(0, 2);
      expect(result.g).toBeCloseTo(1, 2);
      expect(result.b).toBeCloseTo(0, 2);
    });

    it("should evaluate dynamic text-color", () => {
      const spec = { type: "color" as const, default: "#000000" };
      const valueFn = engine.createValueFn(["get", "textColor"], spec, "Point");

      const result = valueFn({
        properties: { textColor: "#0000ff" },
      }) as MapLibreColor;
      expect(result.r).toBeCloseTo(0, 2);
      expect(result.g).toBeCloseTo(0, 2);
      expect(result.b).toBeCloseTo(1, 2);
    });
  });
});
