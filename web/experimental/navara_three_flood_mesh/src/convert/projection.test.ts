import { describe, expect, it } from "vitest";

import { planeRectangularOf, PlaneRectangular } from "./projection";

// Easting, northing, and the degrees PROJ gives (cs2cs EPSG:66xx EPSG:6668).
const CASES: [number, number, number, number, number][] = [
  [9, 22694.98, 11573.375, 140.085398431, 36.104047553],
  [9, -60000, -40000, 139.17083271, 35.637637725],
  [9, 50000, 100000, 140.394376696, 36.899931213],
  [1, 0, 0, 129.5, 33],
  [19, 3000, 5000, 154.029979188, 26.045132506],
];

describe("PlaneRectangular", () => {
  it("matches PROJ to a millimeter", () => {
    for (const [zone, x, y, lng, lat] of CASES) {
      const [l, p] = new PlaneRectangular(zone).toGeographic(x, y);
      expect(Math.abs(l - lng)).toBeLessThan(1e-8);
      expect(Math.abs(p - lat)).toBeLessThan(1e-8);
    }
  });

  it("rejects a zone outside 1 to 19", () => {
    expect(() => new PlaneRectangular(20)).toThrow();
  });
});

describe("planeRectangularOf", () => {
  it("reads the JGD2011 EPSG codes", () => {
    expect(planeRectangularOf("EPSG:6677")?.zone).toBe(9);
    expect(planeRectangularOf("epsg:6687")?.zone).toBe(19);
    expect(planeRectangularOf("EPSG:2451")).toBeUndefined();
  });
});
