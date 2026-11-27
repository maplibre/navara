import { describe, it, expect } from "vitest";

import { toMapLibreGeoJsonId } from "./featureId";

describe("toMapLibreGeoJsonId", () => {
  it("keeps integer ids", () => {
    expect(toMapLibreGeoJsonId(1)).toBe(1);
    expect(toMapLibreGeoJsonId(0)).toBe(0);
  });

  it("parses numeric strings to integers", () => {
    expect(toMapLibreGeoJsonId("12")).toBe(12);
    expect(toMapLibreGeoJsonId("12.7")).toBe(12);
  });

  it("truncates non-integer numbers", () => {
    expect(toMapLibreGeoJsonId(1.5)).toBe(1);
  });

  it("drops ids that are not numbers", () => {
    expect(toMapLibreGeoJsonId("am")).toBeUndefined();
    expect(toMapLibreGeoJsonId("12abc")).toBeUndefined();
    expect(toMapLibreGeoJsonId("")).toBeUndefined();
    expect(toMapLibreGeoJsonId(undefined)).toBeUndefined();
  });
});
