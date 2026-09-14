import { describe, it, expect } from "vitest";

import { getTypeDefault } from "./styleEngineUtils";

describe("styleEngineUtils", () => {
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
