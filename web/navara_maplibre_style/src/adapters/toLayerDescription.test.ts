import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { initSync } from "@navaramap/engine";
import type { Source, VectorLayer } from "@navaramap/three";
import { beforeAll, describe, it, expect, vi } from "vitest";

import { JsStyleEngine } from "../engine/JsStyleEngine";
import { RustStyleEngine } from "../engine/RustStyleEngine";
import type { StyleEngine } from "../engine/StyleEngine";
import type { StyleLayer } from "../engine/types";

import {
  colorReliefLayerFollowsZoom,
  getSymbolPlacement,
  symbolLayerFollowsZoom,
  toLayerDescription,
} from "./toLayerDescription";

// Mock @navaramap/three to avoid loading navara_worker
vi.mock("@navaramap/three", () => ({
  Color: class Color {
    r = 0;
    g = 0;
    b = 0;
    setRGB(r: number, g: number, b: number) {
      this.r = r;
      this.g = g;
      this.b = b;
      return this;
    }
    setStyle(_style: string) {
      return this;
    }
    toArray() {
      return [this.r, this.g, this.b];
    }
  },
}));

/**
 * Color-relief cases that need the expression evaluated at each stop's
 * elevation (MapLibre's _createColorRamp semantics), run against both engines.
 */
const elevationExpressionCases = (getEngine: () => StyleEngine) => {
  const describeColors = (colorExpr: unknown) => {
    const layer = {
      id: "relief",
      type: "color-relief",
      source: "test-dem",
      paint: { "color-relief-color": colorExpr },
    } as unknown as StyleLayer;
    const desc = toLayerDescription(
      {} as Source,
      layer,
      undefined,
      getEngine(),
      10,
    ) as {
      elevationHeatmap: { colorMap: Float32Array; colorStops: Float32Array };
    } | null;
    return {
      stops: Array.from(desc?.elevationHeatmap.colorStops ?? []),
      colors: Array.from(desc?.elevationHeatmap.colorMap ?? []).map(
        (v) => Math.round(v * 1000) / 1000,
      ),
    };
  };

  it("takes stop inputs as meters when the input is an elevation expression", () => {
    // Feet input: like MapLibre, the stop values are used as meters and each
    // color is the expression evaluated at that elevation.
    expect(
      describeColors([
        "interpolate",
        ["linear"],
        ["*", ["elevation"], 3.28],
        0,
        "#000000",
        328,
        "#ffffff",
      ]),
    ).toEqual({ stops: [0, 328], colors: [0, 0, 0, 1, 1, 1, 1, 1] });
  });

  it("evaluates stop colors that read the elevation at the stop", () => {
    expect(
      describeColors([
        "interpolate",
        ["linear"],
        ["elevation"],
        0,
        "#000000",
        100,
        ["rgb", ["/", ["elevation"], 2], 0, 0],
        200,
        "#0000ff",
      ]),
    ).toEqual({
      stops: [0, 100, 200],
      colors: [0, 0, 0, 1, 0.196, 0, 0, 1, 0, 0, 1, 1],
    });
  });
};

describe("toLayerDescription", () => {
  // Mock source object
  const mockSource = {} as Source;

  describe("vector layers", () => {
    it("should convert fill layer", () => {
      const layer: StyleLayer = {
        id: "test-layer",
        type: "fill",
        source: "test",
        paint: {
          "fill-color": "#ff0000",
        },
      };

      const result = toLayerDescription(mockSource, layer);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("vector");
      expect(result).toMatchObject({
        type: "vector",
        source: mockSource,
        polygon: {
          clampToGround: true,
        },
      });
    });

    it("should convert fill-extrusion layer", () => {
      const layer: StyleLayer = {
        id: "test-layer",
        type: "fill-extrusion",
        source: "test",
        paint: {
          "fill-extrusion-color": "#ff0000",
          "fill-extrusion-height": 100,
        },
      };

      const result = toLayerDescription(mockSource, layer);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("vector");
      expect(result).toMatchObject({
        type: "vector",
        source: mockSource,
        polygon: {
          clampToGround: false,
        },
      });
    });

    it("should convert line layer", () => {
      const layer: StyleLayer = {
        id: "test-layer",
        type: "line",
        source: "test",
        paint: {
          "line-color": "#ff0000",
          "line-width": 2,
        },
      };

      const result = toLayerDescription(mockSource, layer);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("vector");
      expect(result).toMatchObject({
        type: "vector",
        source: mockSource,
        polyline: {
          clampToGround: true,
        },
      });
    });

    it("should convert circle layer", () => {
      const layer: StyleLayer = {
        id: "test-layer",
        type: "circle",
        source: "test",
        paint: {
          "circle-color": "#ff0000",
          "circle-radius": 5,
        },
      };

      const result = toLayerDescription(mockSource, layer);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("vector");
      expect(result).toMatchObject({
        type: "vector",
        source: mockSource,
        point: {
          clampToGround: true,
          center: { x: 0, y: -0.5 },
        },
      });
    });
  });

  describe("raster layers", () => {
    it("should convert raster layer", () => {
      const layer: StyleLayer = {
        id: "test-layer",
        type: "raster",
        source: "test",
      };

      const result = toLayerDescription(mockSource, layer);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("raster");
      expect(result).toMatchObject({
        type: "raster",
        source: mockSource,
      });
    });

    it("should convert hillshade layer (paint properties not included in layer description)", () => {
      const layer: StyleLayer = {
        id: "test-layer",
        type: "hillshade",
        source: "test",
        paint: {
          "hillshade-exaggeration": 2.0,
        },
      };

      const result = toLayerDescription(mockSource, layer);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("raster");
      expect(result).toMatchObject({
        type: "raster",
        source: mockSource,
        hillshade: {}, // Paint properties are handled during evaluation, not in layer description
      });
    });

    it("should convert color-relief layer with interpolate expression", () => {
      const layer: StyleLayer = {
        id: "color-relief-layer",
        type: "color-relief",
        source: "test-dem",
        paint: {
          "color-relief-color": [
            "interpolate",
            ["linear"],
            ["elevation"],
            0,
            "#0000ff",
            3000,
            "#ff0000",
          ],
          "color-relief-opacity": 0.8,
          resampling: "nearest",
        },
      };

      const result = toLayerDescription(mockSource, layer);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("raster");
      expect(result).toMatchObject({
        type: "raster",
        source: mockSource,
        elevationHeatmap: {
          minHeight: 0,
          maxHeight: 3000,
          logarithmic: false,
          filter: "nearest",
        },
        raster: {
          opacity: 0.8,
        },
      });
    });
  });

  describe("color-relief stops", () => {
    const reliefLayer = (stops: (number | string)[]): StyleLayer => ({
      id: "relief",
      type: "color-relief",
      source: "test-dem",
      paint: {
        "color-relief-color": [
          "interpolate",
          ["linear"],
          ["elevation"],
          ...stops,
        ],
      },
    });

    it("sorts stops and passes them as colorStops", () => {
      const result = toLayerDescription(
        mockSource,
        reliefLayer([3000, "#ffffff", 0, "#000000", 100, "#ff0000"]),
      );
      expect(result).toMatchObject({
        elevationHeatmap: { minHeight: 0, maxHeight: 3000 },
      });
      const { colorMap, colorStops } = (
        result as {
          elevationHeatmap: {
            colorMap: Float32Array;
            colorStops: Float32Array;
          };
        }
      ).elevationHeatmap;
      expect(colorMap.length).toBe(3 * 4);
      expect(Array.from(colorStops)).toEqual([0, 100, 3000]);
    });

    it("accepts a single stop as a constant color without throwing", () => {
      const result = toLayerDescription(
        mockSource,
        reliefLayer([500, "#00ff00"]),
      );
      expect(result).toMatchObject({
        elevationHeatmap: { minHeight: 500, maxHeight: 501 },
      });
    });

    describe("with a style engine", () => {
      const engine = new JsStyleEngine();
      elevationExpressionCases(() => engine);
      const relief = (paint: Record<string, unknown>): StyleLayer =>
        ({
          id: "relief",
          type: "color-relief",
          source: "test-dem",
          paint: {
            "color-relief-color": [
              "interpolate",
              ["linear"],
              ["elevation"],
              0,
              "#000000",
              100,
              "#ffffff",
            ],
            ...paint,
          },
        }) as StyleLayer;
      type Desc = {
        raster: { opacity: number };
        elevationHeatmap: { filter: string; colorMap: Float32Array };
      };
      const describeAt = (layer: StyleLayer, zoom: number) =>
        toLayerDescription(
          mockSource,
          layer,
          undefined,
          engine,
          zoom,
        ) as Desc | null;

      it("evaluates a zoom expression for color-relief-opacity", () => {
        const layer = relief({
          "color-relief-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0,
            10,
            0.8,
          ],
        });
        expect(describeAt(layer, 5)?.raster.opacity).toBeCloseTo(0);
        expect(describeAt(layer, 7.5)?.raster.opacity).toBeCloseTo(0.4);
        expect(describeAt(layer, 12)?.raster.opacity).toBeCloseTo(0.8);
        expect(colorReliefLayerFollowsZoom(layer)).toBe(true);
      });

      it("evaluates zoom expressions and legacy functions for resampling", () => {
        const step = relief({
          resampling: ["step", ["zoom"], "linear", 15, "nearest"],
        });
        expect(describeAt(step, 14)?.elevationHeatmap.filter).toBe("linear");
        expect(describeAt(step, 15)?.elevationHeatmap.filter).toBe("nearest");
      });

      it("evaluates a legacy zoom function for resampling after parseStyle", async () => {
        // The plugin always parses the style first; migrate() turns legacy
        // functions into expressions.
        const parsed = await engine.parseStyle({
          version: 8,
          sources: {
            "test-dem": {
              type: "raster-dem",
              tiles: ["https://example.com/{z}/{x}/{y}.png"],
            },
          },
          layers: [
            relief({
              resampling: {
                stops: [
                  [14, "linear"],
                  [15, "nearest"],
                ],
              },
            }),
          ],
        });
        const legacy = parsed.layers[0] as StyleLayer;
        expect(describeAt(legacy, 14)?.elevationHeatmap.filter).toBe("linear");
        expect(describeAt(legacy, 15)?.elevationHeatmap.filter).toBe("nearest");
        expect(colorReliefLayerFollowsZoom(legacy)).toBe(true);
      });

      it("evaluates expression stop colors", () => {
        const layer = relief({
          "color-relief-color": [
            "interpolate",
            ["linear"],
            ["elevation"],
            0,
            ["rgb", 255, 0, 0],
            100,
            ["to-color", "#0000ff"],
          ],
        });
        expect(
          Array.from(describeAt(layer, 10)?.elevationHeatmap.colorMap ?? []),
        ).toEqual([1, 0, 0, 1, 0, 0, 1, 1]);
      });

      it("does not follow zoom for constant opacity and resampling", () => {
        expect(
          colorReliefLayerFollowsZoom(
            relief({ "color-relief-opacity": 0.5, resampling: "nearest" }),
          ),
        ).toBe(false);
      });
    });

    describe("with RustStyleEngine (the engine the plugin uses)", () => {
      beforeAll(() => {
        const wasmPath = join(
          dirname(fileURLToPath(import.meta.url)),
          "../../../wasm/navara_engine/navara_wasm_bg.wasm",
        );
        initSync({ module: readFileSync(wasmPath) });
      });

      elevationExpressionCases(() => new RustStyleEngine());

      it("evaluates expression stop colors (straight alpha) like string stops", () => {
        const engine = new RustStyleEngine();
        const layer = {
          id: "relief",
          type: "color-relief",
          source: "test-dem",
          paint: {
            "color-relief-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              0.9,
              12,
              0.4,
            ],
            "color-relief-color": [
              "interpolate",
              ["linear"],
              ["elevation"],
              0,
              ["rgb", 255, 0, 0],
              100,
              ["to-color", "#0000ff"],
              200,
              ["rgba", 0, 255, 0, 0.5],
            ],
            resampling: ["step", ["zoom"], "linear", 12, "nearest"],
          },
        } as unknown as StyleLayer;
        const desc = toLayerDescription(
          mockSource,
          layer,
          undefined,
          engine,
          12,
        ) as {
          raster: { opacity: number };
          elevationHeatmap: {
            filter: string;
            colorMap: Float32Array;
            colorStops: Float32Array;
          };
        } | null;
        expect(Array.from(desc?.elevationHeatmap.colorStops ?? [])).toEqual([
          0, 100, 200,
        ]);
        // Straight-alpha RGBA, with the half-transparent green kept as-is.
        expect(Array.from(desc?.elevationHeatmap.colorMap ?? [])).toEqual([
          1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0.5,
        ]);
        expect(desc?.raster.opacity).toBeCloseTo(0.4);
        expect(desc?.elevationHeatmap.filter).toBe("nearest");
      });
    });

    it("falls back to linear resampling for an unusable value", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // An un-migrated legacy function (invalid StyleLayer typing on purpose).
      const layer = {
        id: "relief",
        type: "color-relief",
        source: "test-dem",
        paint: {
          "color-relief-color": [
            "interpolate",
            ["linear"],
            ["elevation"],
            0,
            "#000",
            100,
            "#fff",
          ],
          resampling: { stops: [[14, "linear"]] },
        },
      } as unknown as StyleLayer;
      // Without an engine the function object cannot be evaluated.
      expect(toLayerDescription(mockSource, layer)).toMatchObject({
        elevationHeatmap: { filter: "linear" },
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("resampling"));
      warn.mockRestore();
    });

    it("warns once and returns null for a non-elevation expression", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const layer: StyleLayer = {
        id: "relief",
        type: "color-relief",
        source: "test-dem",
        paint: {
          "color-relief-color": ["step", ["elevation"], "#000", 100, "#fff"],
        },
      };
      expect(toLayerDescription(mockSource, layer)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe("unsupported and misconfigured layers", () => {
    it("should warn and return null for unsupported layer type", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const layer = {
        id: "test-layer",
        type: "unsupported",
        source: "test",
      } as unknown as StyleLayer;

      const result = toLayerDescription(mockSource, layer);

      // Should return null instead of throwing
      expect(result).toBeNull();

      // Should log a warning with layer context
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Layer "test-layer"'),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported layer type "unsupported"'),
      );

      consoleWarnSpy.mockRestore();
    });

    it("should warn and return null for misconfigured symbol layer", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const layer: StyleLayer = {
        id: "empty-symbol",
        type: "symbol",
        source: "test",
        // No layout with icon-image or text-field
      };

      const result = toLayerDescription(mockSource, layer);

      // Should return null instead of throwing
      expect(result).toBeNull();

      // Should log a warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Symbol layer "empty-symbol"'),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("no icon-image or text-field"),
      );

      consoleWarnSpy.mockRestore();
    });

    it("should return null for text-only symbol layer without fontFamily", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const layer: StyleLayer = {
        id: "text-only-symbol",
        type: "symbol",
        source: "test",
        layout: {
          "text-field": "{name}",
          "text-size": 16,
        },
      };

      // No fontFamily provided
      const result = toLayerDescription(mockSource, layer);

      // Should return null - a text-only layer without font can't render anything
      expect(result).toBeNull();

      // Should log a warning about missing font
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Symbol layer "text-only-symbol"'),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("no font was provided"),
      );

      consoleWarnSpy.mockRestore();
    });

    it("should create billboard-only layer when icon present but no fontFamily for text", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const layer: StyleLayer = {
        id: "icon-and-text-symbol",
        type: "symbol",
        source: "test",
        layout: {
          "icon-image": "marker-icon",
          "text-field": "{name}",
        },
      };

      // No fontFamily provided
      const result = toLayerDescription(mockSource, layer);

      // Should create layer with billboard (icon) but no text
      expect(result).not.toBeNull();
      expect(result?.type).toBe("vector");

      // Verify billboard properties exist
      expect(result).toHaveProperty("billboard");
      // Type guard: after verifying billboard exists, assert type for safe access
      const hasBillboard = result && "billboard" in result;
      expect(hasBillboard).toBe(true);
      // Now safe to access billboard with type assertion
      const layerWithBillboard = result as typeof result & {
        billboard: unknown;
      };
      expect(layerWithBillboard.billboard).toMatchObject({
        url: "marker-icon",
        clampToGround: true,
      });

      expect(result).not.toHaveProperty("text");

      // Should warn about missing font (text skipped)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("no font was provided"),
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe("symbol layout properties", () => {
    const engine = new JsStyleEngine();
    const symbolLayer = (layout: StyleLayer["layout"]): StyleLayer =>
      ({
        id: "symbols",
        type: "symbol",
        source: "test",
        layout,
      }) as StyleLayer;
    const buildSymbol = (layout: StyleLayer["layout"]) =>
      toLayerDescription(mockSource, symbolLayer(layout), "Font", engine) as {
        text?: Record<string, unknown>;
        billboard?: Record<string, unknown>;
      };

    it("maps spec defaults for point placement", () => {
      const { text, billboard } = buildSymbol({
        "text-field": "{name}",
        "icon-image": "marker",
      });

      expect(text).toMatchObject({
        placement: "point",
        textFacing: "upright",
        rotateWithCamera: true,
        spreadGlyphs: false,
        declutter: true,
        maxWidth: 10,
        textAlign: "center",
      });
      expect(text?.geometryTypes).toEqual(["point", "line", "polygon"]);
      expect(billboard).toMatchObject({
        placement: "point",
        billboardFacing: "upright",
        rotateWithCamera: true,
        declutter: true,
      });
      expect(billboard?.geometryTypes).toEqual(["point", "line", "polygon"]);
    });

    it("keeps point geometry only when the filter tests the geometry type", () => {
      for (const filter of [
        ["==", "$type", "Point"],
        ["==", ["geometry-type"], "Point"],
      ]) {
        const { text, billboard } = toLayerDescription(
          mockSource,
          {
            ...symbolLayer({ "text-field": "{name}", "icon-image": "marker" }),
            filter,
          } as StyleLayer,
          "Font",
          engine,
        ) as {
          text?: Record<string, unknown>;
          billboard?: Record<string, unknown>;
        };
        expect(text).not.toHaveProperty("geometryTypes");
        expect(billboard).not.toHaveProperty("geometryTypes");
      }
    });

    it("maps line placement to line geometry with map-aligned text", () => {
      const { text, billboard } = buildSymbol({
        "text-field": "{name}",
        "icon-image": "shield",
        "symbol-placement": "line",
        "symbol-spacing": 400,
        "text-max-angle": 30,
        "text-keep-upright": false,
        "text-max-width": 5,
        "text-justify": "left",
      });

      expect(text).toMatchObject({
        placement: "line",
        geometryTypes: ["line"],
        spacing: 400,
        maxAngle: 30,
        keepUpright: false,
        textFacing: "flat",
        rotateWithCamera: false,
        spreadGlyphs: true,
        maxWidth: 0,
        textAlign: "center",
      });
      expect(billboard).toMatchObject({
        placement: "line",
        geometryTypes: ["line"],
        spacing: 400,
        rotateToLine: true,
        billboardFacing: "flat",
        rotateWithCamera: false,
      });
    });

    it("maps viewport-glyph to spread glyphs facing the camera", () => {
      const { text } = buildSymbol({
        "text-field": "{name}",
        "symbol-placement": "line-center",
        "text-rotation-alignment": "viewport-glyph",
      });

      expect(text).toMatchObject({
        placement: "line-center",
        spreadGlyphs: true,
        rotateWithCamera: true,
        textFacing: "upright",
      });
    });

    it("maps viewport rotation along a line to a straight label", () => {
      const { text } = buildSymbol({
        "text-field": "{name}",
        "symbol-placement": "line",
        "symbol-spacing": 300,
        "text-rotation-alignment": "viewport",
      });

      // Turning with the camera without spreadGlyphs draws the label
      // straight at each anchor, repeated every `spacing`.
      expect(text).toMatchObject({
        placement: "line",
        spacing: 300,
        rotateWithCamera: true,
        spreadGlyphs: false,
        textFacing: "upright",
        maxWidth: 0,
      });
    });

    it("evaluates zoom-following layer properties at the given zoom", () => {
      const layer = symbolLayer({
        "text-field": "{name}",
        "text-max-width": ["step", ["zoom"], 10, 14, 6],
        "text-pitch-alignment": ["step", ["zoom"], "viewport", 14, "map"],
      });
      const build = (zoom?: number) =>
        toLayerDescription(mockSource, layer, "Font", engine, zoom) as {
          text?: Record<string, unknown>;
        };

      expect(build().text).toMatchObject({
        maxWidth: 10,
        textFacing: "upright",
      });
      expect(build(15).text).toMatchObject({
        maxWidth: 6,
        textFacing: "flat",
      });
    });

    it("detects layer-level properties that follow zoom", () => {
      const zoomStep = ["step", ["zoom"], "map", 14, "viewport"];
      expect(
        symbolLayerFollowsZoom(
          symbolLayer({
            "text-field": "a",
            "text-rotation-alignment": zoomStep,
          }),
        ),
      ).toBe(true);
      expect(
        symbolLayerFollowsZoom({
          ...symbolLayer({ "text-field": "a" }),
          paint: {
            "text-halo-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              1,
              10,
              3,
            ],
          },
        } as StyleLayer),
      ).toBe(true);
      // Per-feature properties and geometry ones do not need layer.update().
      expect(
        symbolLayerFollowsZoom(
          symbolLayer({
            "text-field": "a",
            "text-size": ["interpolate", ["linear"], ["zoom"], 0, 10, 10, 20],
            "symbol-spacing": ["step", ["zoom"], 100, 14, 300],
          }),
        ),
      ).toBe(false);
    });

    it("maps explicit pitch alignment independently of rotation", () => {
      const { text, billboard } = buildSymbol({
        "text-field": "{name}",
        "icon-image": "marker",
        "text-pitch-alignment": "map",
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "viewport",
      });

      expect(text).toMatchObject({
        textFacing: "flat",
        rotateWithCamera: true,
      });
      expect(billboard).toMatchObject({
        billboardFacing: "upright",
        rotateWithCamera: false,
      });
    });

    it("maps overlap properties", () => {
      const defaults = buildSymbol({
        "text-field": "{name}",
        "icon-image": "marker",
      });
      for (const desc of [defaults.text, defaults.billboard]) {
        expect(desc).toMatchObject({
          overlap: "never",
          ignorePlacement: false,
        });
      }

      const allow = buildSymbol({
        "text-field": "{name}",
        "icon-image": "marker",
        "text-allow-overlap": true,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      });
      expect(allow.text).toMatchObject({
        overlap: "always",
        ignorePlacement: false,
      });
      expect(allow.billboard).toMatchObject({
        overlap: "always",
        ignorePlacement: true,
      });

      // `*-overlap` takes precedence over `*-allow-overlap`.
      const overlap = buildSymbol({
        "text-field": "{name}",
        "icon-image": "marker",
        "text-allow-overlap": true,
        "text-overlap": "cooperative",
        "text-ignore-placement": true,
        "icon-overlap": "always",
      });
      expect(overlap.text).toMatchObject({
        overlap: "cooperative",
        ignorePlacement: true,
      });
      expect(overlap.billboard?.overlap).toBe("always");
    });

    it("pairs text and icon unless the partner is optional or missing", () => {
      const paired = buildSymbol({
        "text-field": "{name}",
        "icon-image": "marker",
      });
      expect(paired.text?.standalone).toBe(false);
      expect(paired.billboard?.standalone).toBe(false);

      // `text-optional` lets the icon show alone, and vice versa.
      const optional = buildSymbol({
        "text-field": "{name}",
        "icon-image": "marker",
        "text-optional": true,
      });
      expect(optional.text?.standalone).toBe(false);
      expect(optional.billboard?.standalone).toBe(true);

      expect(buildSymbol({ "text-field": "{name}" }).text?.standalone).toBe(
        true,
      );
      expect(
        buildSymbol({ "icon-image": "marker" }).billboard?.standalone,
      ).toBe(true);
    });

    it("maps text and icon padding", () => {
      const defaults = buildSymbol({
        "text-field": "{name}",
        "icon-image": "marker",
      });
      expect(defaults.text?.declutterPadding).toEqual([2]);
      expect(defaults.billboard?.declutterPadding).toEqual([2]);

      const padded = buildSymbol({
        "text-field": "{name}",
        "icon-image": "marker",
        "text-padding": 0,
        "icon-padding": [1, 4],
      });
      expect(padded.text?.declutterPadding).toEqual([0]);
      expect(padded.billboard?.declutterPadding).toEqual([1, 4]);

      expect(
        symbolLayerFollowsZoom(
          symbolLayer({
            "text-field": "a",
            "text-padding": ["interpolate", ["linear"], ["zoom"], 0, 0, 10, 8],
          }),
        ),
      ).toBe(true);
    });

    it("evaluates padding expressions at the whole zoom", () => {
      const { billboard } = toLayerDescription(
        mockSource,
        symbolLayer({
          "icon-image": "marker",
          "icon-padding": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            ["literal", [0, 10]],
            10,
            ["literal", [10, 20]],
          ],
        }),
        "Font",
        engine,
        5.9,
      ) as VectorLayer;
      expect(billboard?.declutterPadding).toEqual([5, 15, 5, 15]);
    });

    it("ranks text and icons by the layer's index in the style", () => {
      const { text, billboard } = toLayerDescription(
        mockSource,
        symbolLayer({ "text-field": "{name}", "icon-image": "marker" }),
        "Font",
        engine,
        undefined,
        7,
      ) as VectorLayer;
      expect(text?.declutterRank).toBe(7);
      expect(billboard?.declutterRank).toBe(7);
    });

    it("maps an explicit icon-anchor to the sprite center", () => {
      expect(
        buildSymbol({ "icon-image": "pin", "icon-anchor": "bottom" }).billboard
          ?.center,
      ).toEqual({ x: 0, y: -0.5 });
      expect(
        buildSymbol({ "icon-image": "pin", "icon-anchor": "top-left" })
          .billboard?.center,
      ).toEqual({ x: -0.5, y: 0.5 });
    });

    it("keeps the icon/text pairing center when icon-anchor is unset", () => {
      expect(
        buildSymbol({ "icon-image": "pin", "text-field": "{name}" }).billboard
          ?.center,
      ).toEqual({ x: 1.0, y: -0.5 });
    });

    it("resolves symbol placement", () => {
      expect(
        getSymbolPlacement(symbolLayer({ "symbol-placement": "line" }), engine),
      ).toBe("line");
      expect(getSymbolPlacement(symbolLayer({}), engine)).toBe("point");
      expect(
        getSymbolPlacement(symbolLayer({ "symbol-placement": "line" })),
      ).toBe("point");
    });
  });
});
