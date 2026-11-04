import { describe, it, expect, vi } from "vitest";

import {
  getTypeDefault,
  isLiteralArray,
  validateAndMigrateStyle,
} from "./styleEngineUtils";

describe("styleEngineUtils", () => {
  describe("isLiteralArray", () => {
    it("takes an array-typed value not led by an operator as a literal", () => {
      const array = { type: "array" as const };
      expect(isLiteralArray(["Open Sans Regular"], array)).toBe(true);
      expect(isLiteralArray(["top", "bottom"], array)).toBe(true);
      expect(
        isLiteralArray(["top", [0, 1], "left", [1, 0]], {
          type: "variableAnchorOffsetCollection" as const,
        }),
      ).toBe(true);
      expect(isLiteralArray(["get", "name"], array)).toBe(false);
      expect(
        isLiteralArray(["invalid-op", "x"], { type: "color" as const }),
      ).toBe(false);
    });
  });

  describe("getTypeDefault", () => {
    it("should return correct defaults for each type", () => {
      expect(getTypeDefault("number")).toBe(0);
      expect(getTypeDefault("boolean")).toBe(false);
      expect(getTypeDefault("string")).toBe("");
      expect(getTypeDefault("formatted")).toBe("");
      expect(getTypeDefault("resolvedImage")).toBe("");
      expect(getTypeDefault("array")).toEqual([]);
    });

    it("should return color object for color type", () => {
      const result = getTypeDefault("color");

      expect(result).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    });

    it("should return empty string for unknown types", () => {
      const result = getTypeDefault("unknown" as any);

      expect(result).toBe("");
    });
  });

  describe("validateAndMigrateStyle", () => {
    const circleStyle = (layer: Record<string, unknown>) => ({
      version: 8,
      sources: {
        a: {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        },
      },
      layers: [{ id: "a", type: "circle", source: "a", ...layer }],
    });

    it("migrates a one-stop interval function to a valid step", () => {
      // migrate() alone yields ["step", input, "blue", 0, 0], which fails
      // validation (regressions/mapbox-gl-js#4146).
      const parsed = validateAndMigrateStyle(
        circleStyle({
          paint: {
            "circle-color": {
              type: "interval",
              property: "property",
              stops: [[0, "blue"]],
            },
          },
        }),
      );

      const paint = parsed.layers[0].paint as Record<string, unknown>;
      expect(paint["circle-color"]).toEqual([
        "step",
        ["number", ["get", "property"]],
        "blue",
        0,
        "blue",
      ]);
    });

    it("migrates a one-zoom zoom-and-property interval function", () => {
      const parsed = validateAndMigrateStyle(
        circleStyle({
          layout: {
            "circle-sort-key": {
              type: "interval",
              property: "p",
              stops: [[{ zoom: 0, value: 0 }, 5]],
            },
          },
        }),
      );

      const inner = ["step", ["number", ["get", "p"]], 5, 0, 5];
      const layout = parsed.layers[0].layout as Record<string, unknown>;
      expect(layout["circle-sort-key"]).toEqual([
        "step",
        ["zoom"],
        inner,
        1,
        inner,
      ]);
    });

    it("migrates a one-stop zoom interval function to a valid step", () => {
      const parsed = validateAndMigrateStyle(
        circleStyle({
          paint: { "circle-color": { type: "interval", stops: [[0, "blue"]] } },
        }),
      );

      const paint = parsed.layers[0].paint as Record<string, unknown>;
      expect(paint["circle-color"]).toEqual([
        "step",
        ["zoom"],
        "blue",
        0,
        "blue",
      ]);
    });

    it("leaves one-stop functions that do not become a step unchanged", () => {
      const parsed = validateAndMigrateStyle(
        circleStyle({
          paint: {
            "circle-radius": { stops: [[0, 5]] },
            "circle-color": {
              type: "categorical",
              property: "p",
              stops: [["x", "blue"]],
            },
          },
        }),
      );

      const paint = parsed.layers[0].paint as Record<string, unknown>;
      expect(paint["circle-radius"]).toEqual([
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        5,
      ]);
      expect(paint["circle-color"]).toEqual([
        "match",
        ["get", "p"],
        "x",
        "blue",
        "#000000",
      ]);
    });

    it("validates after migrating, so legacy styles still load", () => {
      // Both fail validation as written; migrate() upgrades v7 and
      // normalizes non-CSS hsl colors.
      const background = (version: number, color: string) => ({
        version,
        sources: {},
        layers: [
          { id: "b", type: "background", paint: { "background-color": color } },
        ],
      });

      expect(() => validateAndMigrateStyle(background(7, "red"))).not.toThrow();
      expect(() =>
        validateAndMigrateStyle(background(8, "hsl(900, 0.15, 90%)")),
      ).not.toThrow();
    });

    it("logs warnings instead of rejecting the style", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        // Mixing legacy and expression filter syntax is a warning
        // (filter/mixed-legacy-expression).
        const parsed = validateAndMigrateStyle(
          circleStyle({
            filter: [
              "any",
              ["==", ["get", "position"], "left"],
              ["==", "position", "left"],
            ],
          }),
        );

        expect(parsed.layers).toHaveLength(1);
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("rejects a style with errors", () => {
      expect(() =>
        validateAndMigrateStyle(
          circleStyle({ paint: { "circle-radius": "x" } }),
        ),
      ).toThrow(/Invalid MapLibre Style/);
    });
  });
});
