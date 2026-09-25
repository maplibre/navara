import { describe, it, expect, vi } from "vitest";

import { JsStyleEngine } from "../engine/JsStyleEngine";
import type { StyleLayer } from "../engine/types";

import {
  createPaintEvaluators,
  toEvaluatedValue,
  toNavaraColor,
} from "./toEvaluatedValue";

// Type for the mock Color class with exposed r, g, b properties
type MockColor = {
  r: number;
  g: number;
  b: number;
  setRGB(r: number, g: number, b: number): MockColor;
  setStyle(style: string): MockColor;
};

// Mock @navaramap/three to avoid importing Three.js in tests
vi.mock("@navaramap/three", () => ({
  Color: class Color implements MockColor {
    r = 0;
    g = 0;
    b = 0;

    setRGB(r: number, g: number, b: number) {
      // Set RGB values directly (0-1 range)
      this.r = r;
      this.g = g;
      this.b = b;
      return this;
    }

    setStyle(style: string) {
      // Simple color parser for testing fallback defaults
      if (style.startsWith("#")) {
        const hex = style.slice(1);
        this.r = parseInt(hex.slice(0, 2), 16) / 255;
        this.g = parseInt(hex.slice(2, 4), 16) / 255;
        this.b = parseInt(hex.slice(4, 6), 16) / 255;
      } else if (style.startsWith("rgb")) {
        const match = style.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
          this.r = parseInt(match[1]) / 255;
          this.g = parseInt(match[2]) / 255;
          this.b = parseInt(match[3]) / 255;
        }
      }
      return this;
    }
  },
}));

describe("createPaintEvaluators", () => {
  const engine = new JsStyleEngine();

  it("should return empty object when no paint properties", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
    };

    const evaluators = createPaintEvaluators(layer, engine, "Polygon");

    expect(evaluators).toEqual({});
  });

  it("should create evaluators for fill paint properties", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
      paint: {
        "fill-color": "#ff0000",
        "fill-opacity": 0.5,
      },
    };

    const evaluators = createPaintEvaluators(layer, engine, "Polygon");

    expect(evaluators["fill-color"]).toBeDefined();
    expect(evaluators["fill-opacity"]).toBeDefined();

    // Test evaluation - MapLibre returns Color object
    const color = evaluators["fill-color"]({ properties: {} }) as {
      r: number;
      g: number;
      b: number;
    };
    expect(color.r).toBeCloseTo(1, 2);
    expect(color.g).toBeCloseTo(0, 2);
    expect(color.b).toBeCloseTo(0, 2);

    const opacity = evaluators["fill-opacity"]({ properties: {} });
    expect(opacity).toBe(0.5);
  });

  it("should create evaluators with expressions", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
      paint: {
        "fill-color": ["get", "color"],
      },
    };

    const evaluators = createPaintEvaluators(layer, engine, "Polygon");

    const colorEvaluator = evaluators["fill-color"];
    const color = colorEvaluator({ properties: { color: "#00ff00" } }) as {
      r: number;
      g: number;
      b: number;
    };
    expect(color.r).toBeCloseTo(0, 2);
    expect(color.g).toBeCloseTo(1, 2);
    expect(color.b).toBeCloseTo(0, 2);
  });

  it("should use default value when property value is undefined", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
      paint: {
        "fill-color": undefined,
      },
    };

    const evaluators = createPaintEvaluators(layer, engine, "Polygon");

    expect(evaluators["fill-color"]).toBeDefined();
    // Default fill-color is black
    const color = evaluators["fill-color"]({ properties: {} }) as {
      r: number;
      g: number;
      b: number;
    };
    expect(color.r).toBeCloseTo(0, 2);
    expect(color.g).toBeCloseTo(0, 2);
    expect(color.b).toBeCloseTo(0, 2);
  });
});

describe("toEvaluatedValue", () => {
  it("should convert fill-color Color object to Navara color", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
    };

    // MapLibre always returns Color objects from expression evaluation
    const paintValues = {
      "fill-color": { r: 1, g: 0, b: 0, a: 1 },
    };

    const result = toEvaluatedValue(layer, paintValues);

    expect(result.color).toBeDefined();
    expect(result.show).toBe(true);
  });

  it("should handle undefined color values", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
    };

    const paintValues = {
      "fill-color": undefined,
    };

    const result = toEvaluatedValue(layer, paintValues);

    expect(result.color).toBeUndefined();
    expect(result.show).toBe(true);
  });

  it("should handle CSS string fallback defaults", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
    };

    // spec.default often returns CSS strings like "#000000"
    const paintValues = {
      "fill-color": "#ff0000",
    };

    const result = toEvaluatedValue(layer, paintValues);

    expect(result.color).toBeDefined();
    expect(result.show).toBe(true);
  });

  it("should handle invalid Color objects gracefully", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
    };

    // Invalid Color object with missing numeric fields
    const paintValues = {
      "fill-color": { r: 1, g: "invalid", b: 0 },
    };

    const result = toEvaluatedValue(layer, paintValues);

    // Should not crash, but color will be undefined
    expect(result.color).toBeUndefined();
    expect(result.show).toBe(true);
  });

  it("should map fill-opacity to result opacity", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
    };

    const paintValues = {
      "fill-color": { r: 1, g: 0, b: 0, a: 1 },
      "fill-opacity": 0.5,
    };

    const result = toEvaluatedValue(layer, paintValues);

    expect(result.opacity).toBeCloseTo(0.5, 2);
  });

  it("should use color alpha when no paint opacity specified", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
    };

    const paintValues = {
      "fill-color": { r: 1, g: 0, b: 0, a: 0.7 },
    };

    const result = toEvaluatedValue(layer, paintValues);

    expect(result.opacity).toBeCloseTo(0.7, 2);
  });

  it("should multiply color alpha with paint opacity", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
    };

    const paintValues = {
      "fill-color": { r: 1, g: 0, b: 0, a: 0.8 },
      "fill-opacity": 0.5,
    };

    const result = toEvaluatedValue(layer, paintValues);

    expect(result.opacity).toBeCloseTo(0.4, 2); // 0.8 * 0.5
  });

  it("should handle line-opacity for line layers", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "line",
      source: "test",
    };

    const paintValues = {
      "line-color": { r: 0, g: 0, b: 1, a: 0.6 },
      "line-opacity": 0.5,
    };

    const result = toEvaluatedValue(layer, paintValues);

    expect(result.opacity).toBeCloseTo(0.3, 2); // 0.6 * 0.5
  });

  it("should handle circle-opacity for circle layers", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "circle",
      source: "test",
    };

    const paintValues = {
      "circle-color": { r: 0, g: 1, b: 0, a: 1 },
      "circle-opacity": 0.75,
    };

    const result = toEvaluatedValue(layer, paintValues);

    expect(result.opacity).toBeCloseTo(0.75, 2);
  });

  it("should default to alpha 1.0 for CSS color strings", () => {
    const layer: StyleLayer = {
      id: "test",
      type: "fill",
      source: "test",
    };

    const paintValues = {
      "fill-color": "#ff0000",
    };

    const result = toEvaluatedValue(layer, paintValues);

    expect(result.opacity).toBeCloseTo(1.0, 2);
  });

  describe("symbol layer geometryType requirement", () => {
    it("should warn and skip processing when geometryType is undefined", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const layer: StyleLayer = {
        id: "test",
        type: "symbol",
        source: "test",
      };

      const paintValues = {
        "icon-color": { r: 1, g: 0, b: 0, a: 1 },
        "text-color": { r: 0, g: 0, b: 1, a: 1 },
      };

      const layoutValues = {
        "icon-image": "/icons/marker.svg",
        "text-field": "Label",
      };

      // geometryType is undefined - should warn and skip
      const warnedLayers = new Set<string>();
      const result = toEvaluatedValue(
        layer,
        paintValues,
        layoutValues,
        undefined,
        warnedLayers,
      );

      // Should have logged a warning (once per layer)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Symbol layer "test": missing meshGeomType'),
      );

      // Should not process any symbol properties
      expect(result.image).toBeUndefined();
      expect(result.text).toBeUndefined();
      expect(result.size).toBeUndefined();

      // But should still set show flag
      expect(result.show).toBe(true);

      consoleWarnSpy.mockRestore();
    });

    it("should only process icon when geometryType is billboard", () => {
      const layer: StyleLayer = {
        id: "test",
        type: "symbol",
        source: "test",
      };

      const paintValues = {
        "icon-color": { r: 1, g: 0, b: 0, a: 1 },
        "text-color": { r: 0, g: 0, b: 1, a: 1 },
      };

      const layoutValues = {
        "icon-image": "/icons/marker.svg",
        "text-field": "Label",
      };

      // geometryType is explicitly "billboard"
      const result = toEvaluatedValue(
        layer,
        paintValues,
        layoutValues,
        "billboard",
      );

      // Only icon should be processed
      expect(result.image).toBe("/icons/marker.svg");
      expect(result.text).toBeUndefined();
    });

    it("should only process text when geometryType is text", () => {
      const layer: StyleLayer = {
        id: "test",
        type: "symbol",
        source: "test",
      };

      const paintValues = {
        "icon-color": { r: 1, g: 0, b: 0, a: 1 },
        "text-color": { r: 0, g: 0, b: 1, a: 1 },
      };

      const layoutValues = {
        "icon-image": "/icons/marker.svg",
        "text-field": "Label",
      };

      // geometryType is explicitly "text"
      const result = toEvaluatedValue(layer, paintValues, layoutValues, "text");

      // Only text should be processed
      expect(result.text).toBe("Label");
      expect(result.image).toBeUndefined();
    });

    it("should warn and skip when geometryType is invalid (not billboard or text)", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const layer: StyleLayer = {
        id: "test",
        type: "symbol",
        source: "test",
      };

      const paintValues = {
        "icon-color": { r: 1, g: 0, b: 0, a: 1 },
        "text-color": { r: 0, g: 0, b: 1, a: 1 },
      };

      const layoutValues = {
        "icon-image": "/icons/marker.svg",
        "text-field": "Label",
      };

      // meshGeomType is "point" (wiring mistake - should be "billboard" or "text")
      const warnedLayers = new Set<string>();
      const result = toEvaluatedValue(
        layer,
        paintValues,
        layoutValues,
        "point" as any,
        warnedLayers,
      );

      // Should warn about invalid meshGeomType
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid meshGeomType "point"'),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Expected "billboard" or "text"'),
      );

      // Should not process any symbol properties
      expect(result.image).toBeUndefined();
      expect(result.text).toBeUndefined();
      expect(result.size).toBeUndefined();

      // But should still set show flag
      expect(result.show).toBe(true);

      consoleWarnSpy.mockRestore();
    });
  });

  describe("fill-extrusion layer conversion", () => {
    it("should convert base=0, top>0 to height=0 and extrudedHeight=top", () => {
      const layer: StyleLayer = {
        id: "test",
        type: "fill-extrusion",
        source: "test",
      };

      const paintValues = {
        "fill-extrusion-base": 0,
        "fill-extrusion-height": 50,
      };

      const result = toEvaluatedValue(layer, paintValues);

      expect(result.height).toBe(0);
      expect(result.extrudedHeight).toBe(50);
    });

    it("should convert base>0, top>base to height=base and extrudedHeight=(top-base)", () => {
      const layer: StyleLayer = {
        id: "test",
        type: "fill-extrusion",
        source: "test",
      };

      const paintValues = {
        "fill-extrusion-base": 20,
        "fill-extrusion-height": 80,
      };

      const result = toEvaluatedValue(layer, paintValues);

      expect(result.height).toBe(20);
      expect(result.extrudedHeight).toBe(60); // 80 - 20
    });

    it("should clamp negative delta when base>top (height=base, no extrudedHeight)", () => {
      const layer: StyleLayer = {
        id: "test",
        type: "fill-extrusion",
        source: "test",
      };

      const paintValues = {
        "fill-extrusion-base": 100,
        "fill-extrusion-height": 50,
      };

      const result = toEvaluatedValue(layer, paintValues);

      // Base is still set to height
      expect(result.height).toBe(100);
      // But extrudedHeight should not be set (delta clamped to 0, then filtered by > 0 check)
      expect(result.extrudedHeight).toBeUndefined();
    });

    it("should use defaults (0) when values are missing", () => {
      const layer: StyleLayer = {
        id: "test",
        type: "fill-extrusion",
        source: "test",
      };

      // Missing both base and height
      const paintValues = {};

      const result = toEvaluatedValue(layer, paintValues);

      expect(result.height).toBe(0);
      // extrudedHeight not set because delta = max(0, 0 - 0) = 0, which fails > 0 check
      expect(result.extrudedHeight).toBeUndefined();
    });
  });
});

describe("toNavaraColor", () => {
  it("should parse CSS color strings with MapLibre Color.parse", () => {
    const result = toNavaraColor("#ff0000");

    expect(result).toBeDefined();
    expect((result?.color as unknown as MockColor).r).toBe(1);
    expect((result?.color as unknown as MockColor).g).toBe(0);
    expect((result?.color as unknown as MockColor).b).toBe(0);
    expect(result?.alpha).toBe(1.0);
  });

  it("should extract alpha from rgba() strings", () => {
    const result = toNavaraColor("rgba(255, 0, 0, 0.5)");

    expect(result).toBeDefined();
    expect(result?.alpha).toBe(0.5);
  });

  it("should extract alpha from #RRGGBBAA strings", () => {
    const result = toNavaraColor("#ff0000cc");

    expect(result).toBeDefined();
    expect(result?.alpha).toBeCloseTo(0.8, 1);
  });

  it("should handle MapLibreColor objects", () => {
    const maplibreColor = { r: 1, g: 0, b: 0, a: 0.7 };
    const result = toNavaraColor(maplibreColor);

    expect(result).toBeDefined();
    expect((result?.color as unknown as MockColor).r).toBe(1);
    expect((result?.color as unknown as MockColor).g).toBe(0);
    expect((result?.color as unknown as MockColor).b).toBe(0);
    expect(result?.alpha).toBe(0.7);
  });

  it("should return undefined for invalid color strings", () => {
    const result = toNavaraColor("invalid-color");

    expect(result).toBeUndefined();
  });
});
