import { Matrix4, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { buildPositions, toGeoJsonRings } from "./featurePositions";

// The geodesy is WASM and covered elsewhere; a transparent model that maps
// lng/lat/height onto x/y/z keeps these tests about the wiring alone.
vi.mock("@navaramap/three", () => ({
  geodeticToVector3: (p: { lng: number; lat: number; height: number }) =>
    new Vector3(p.lng, p.lat, p.height),
  vector3ToGeodetic: (v: Vector3) => ({ lng: v.x, lat: v.y, height: v.z }),
}));

const TRANSLATE = new Matrix4().makeTranslation(10, 20, 30);

describe("buildPositions", () => {
  it("keeps geodetic input geodetic without a transform", () => {
    const built = buildPositions({
      positions: [
        { lng: 1, lat: 2, height: 3 },
        { lng: 4, lat: 5, height: 6 },
      ],
    });
    expect(built.geocentric).toBe(false);
    expect(Array.from(built.rings[0])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("applies the transform to cartesian points", () => {
    const built = buildPositions({ points: [{ x: 1, y: 2, z: 3 }] }, TRANSLATE);
    expect(built.geocentric).toBe(true);
    expect(Array.from(built.rings[0])).toEqual([11, 22, 33]);
  });

  it("applies the transform to the ECEF positions of geodetic input", () => {
    const built = buildPositions(
      {
        geojson: {
          type: "LineString",
          coordinates: [
            [1, 2],
            [4, 5, 6],
          ],
        },
      },
      TRANSLATE,
    );
    expect(built.geocentric).toBe(true);
    expect(Array.from(built.rings[0])).toEqual([11, 22, 30, 14, 25, 36]);
  });
});

describe("toGeoJsonRings", () => {
  it("converts geocentric rings back to geodetic positions", () => {
    const built = buildPositions(
      { positions: [{ lng: 1, lat: 2, height: 3 }] },
      TRANSLATE,
    );
    expect(toGeoJsonRings(built)).toEqual([[[11, 22, 33]]]);
  });
});
