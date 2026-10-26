import type { Source, VectorLayer } from "@navaramap/three";
import { describe, it, expect, vi } from "vitest";

import { JsStyleEngine } from "../engine/JsStyleEngine";
import type { StyleLayer } from "../engine/types";

import {
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
  },
}));

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
