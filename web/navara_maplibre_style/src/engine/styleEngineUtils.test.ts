import { describe, it, expect } from "vitest";

import { getTypeDefault, isLiteralArray } from "./styleEngineUtils";

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
});
