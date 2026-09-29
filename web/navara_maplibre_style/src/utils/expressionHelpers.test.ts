import { describe, it, expect } from "vitest";

import { expressionUsesZoom } from "./expressionHelpers";

describe("expressionUsesZoom", () => {
  describe("Modern expressions", () => {
    it("should detect zoom expression", () => {
      expect(expressionUsesZoom(["zoom"])).toBe(true);
      expect(expressionUsesZoom(["+", ["zoom"], 5])).toBe(true);
    });

    it("should return false for non-zoom expression", () => {
      expect(expressionUsesZoom(["get", "name"])).toBe(false);
      expect(expressionUsesZoom("#ff0000")).toBe(false);
    });
  });

  describe("Legacy zoom functions", () => {
    it("should detect zoom function with stops", () => {
      expect(
        expressionUsesZoom({
          stops: [
            [5, 10],
            [10, 20],
          ],
        }),
      ).toBe(true);
    });
  });

  describe("Property-only functions", () => {
    it("should return false for property-only function", () => {
      const propertyFunction = {
        property: "temperature",
        stops: [
          [0, "#0000ff"],
          [100, "#ff0000"],
        ],
      };
      expect(expressionUsesZoom(propertyFunction)).toBe(false);
    });
  });

  describe("Composite functions (zoom-and-property)", () => {
    it("should detect composite with zoom in all stops", () => {
      const composite = {
        property: "temp",
        stops: [
          [{ zoom: 5, value: 0 }, "#00f"],
          [{ zoom: 10, value: 100 }, "#f00"],
        ],
      };
      expect(expressionUsesZoom(composite)).toBe(true);
    });

    it("should detect composite with zoom only in middle stop", () => {
      const composite = {
        property: "density",
        stops: [
          [0, 2],
          [{ zoom: 10, value: 50 }, 5],
          [100, 10],
        ],
      };
      expect(expressionUsesZoom(composite)).toBe(true);
    });
  });

  describe("Invalid property values", () => {
    it("should treat invalid property as zoom function", () => {
      expect(
        expressionUsesZoom({ property: undefined, stops: [[5, 10]] }),
      ).toBe(true);
      expect(expressionUsesZoom({ property: null, stops: [[5, 10]] })).toBe(
        true,
      );
      expect(expressionUsesZoom({ property: "", stops: [[5, 10]] })).toBe(true);
      expect(expressionUsesZoom({ property: 123, stops: [[5, 10]] })).toBe(
        true,
      );
    });
  });

  describe("Nested structures", () => {
    it("should detect zoom in nested objects", () => {
      const nested = {
        paint: { color: { stops: [[5, "#f00"]] } },
      };
      expect(expressionUsesZoom(nested)).toBe(true);
    });

    it("should return false for non-zoom nested structures", () => {
      const noZoom = {
        paint: {
          color: "#ff0000",
          opacity: { property: "x", stops: [[0, 0.5]] },
        },
      };
      expect(expressionUsesZoom(noZoom)).toBe(false);
    });
  });
});
