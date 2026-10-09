import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { initTestEngine } from "../../test-utils/engine";

import { exaggeratedTerrainBounds } from "./terrainExaggeration";

const center = new Vector3(100, 200, 300);

initTestEngine();
const extent = new Vector3(10, 20, 30);

describe("exaggeratedTerrainBounds", () => {
  it("keeps the unexaggerated bounds at scale 1", () => {
    const { box, sphere } = exaggeratedTerrainBounds(
      center,
      extent,
      -50,
      1000,
      [1, 0],
    );
    expect(box.min.toArray()).toEqual([90, 180, 270]);
    expect(box.max.toArray()).toEqual([110, 220, 330]);
    expect(sphere.center.toArray()).toEqual(center.toArray());
    expect(sphere.radius).toBeCloseTo(extent.length());
  });

  it("grows by the largest displacement over the height range", () => {
    // max: 1000 -> 3000 (+2000), min: -50 -> -150 (-100).
    const { box, sphere } = exaggeratedTerrainBounds(
      center,
      extent,
      -50,
      1000,
      [3, 0],
    );
    expect(box.min.toArray()).toEqual([-1910, -1820, -1730]);
    expect(box.max.toArray()).toEqual([2110, 2220, 2330]);
    expect(sphere.radius).toBeCloseTo(extent.length() + 2000);
  });

  it("measures the displacement around the relative height", () => {
    // min: 0 -> (0 - 1000) * 2 + 1000 = -1000, max: 1000 stays.
    const { box } = exaggeratedTerrainBounds(
      center,
      extent,
      0,
      1000,
      [2, 1000],
    );
    expect(box.max.toArray()).toEqual([1110, 1220, 1330]);
  });

  it("does not alias the inputs", () => {
    const { box, sphere } = exaggeratedTerrainBounds(
      center,
      extent,
      0,
      100,
      [2, 0],
    );
    box.min.set(0, 0, 0);
    sphere.center.set(0, 0, 0);
    expect(center.toArray()).toEqual([100, 200, 300]);
    expect(extent.toArray()).toEqual([10, 20, 30]);
  });
});
