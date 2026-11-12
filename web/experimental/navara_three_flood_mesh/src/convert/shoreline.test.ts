import { describe, expect, it } from "vitest";

import { refineSignedDistance, unionBoundary } from "./shoreline";

const ring = (...xy: number[]) =>
  Array.from({ length: xy.length / 2 }, (_, i) => ({
    x: xy[2 * i],
    y: xy[2 * i + 1],
  }));

// Segments as sorted `x0,y0-x1,y1` strings, each with its endpoints sorted.
const segmentsOf = (segments: Float64Array) =>
  Array.from({ length: segments.length / 4 }, (_, i) => {
    const [x0, y0, x1, y1] = segments.subarray(4 * i, 4 * i + 4);
    return [`${x0},${y0}`, `${x1},${y1}`].sort().join("-");
  }).sort();

describe("unionBoundary", () => {
  it("cancels an edge shared between two polygons with different vertices", () => {
    // A 2 × 1 rectangle next to two unit squares: their shared edge is split
    // at (2, 1) on the squares' side only.
    const segments = unionBoundary([
      ring(0, 0, 2, 0, 2, 2, 0, 2),
      ring(2, 0, 3, 0, 3, 1, 2, 1),
      ring(2, 1, 3, 1, 3, 2, 2, 2),
    ]);
    expect(segmentsOf(segments)).toEqual(
      [
        "0,0-2,0",
        "2,0-3,0",
        "3,0-3,1",
        "3,1-3,2",
        "2,2-3,2",
        "0,2-2,2",
        "0,0-0,2",
      ].sort(),
    );
  });
});

describe("refineSignedDistance", () => {
  it("measures the distance to a shoreline between the cell centers", () => {
    // Wet where x < 2.7, on a 5 × 1 grid of 10 m cells. The coarse distance
    // puts the shoreline at x = 3, halfway between cell centers 2.5 and 3.5;
    // its last value stands in for one 2 cells out.
    const out = refineSignedDistance(
      Float32Array.from([-25, -15, -5, 5, 20]),
      Uint8Array.from([1, 1, 1, 0, 0]),
      Float64Array.from([2.7, -1, 2.7, 2]),
      5,
      1,
      10,
      10,
    );
    expect(out[0]).toBe(-25);
    expect(out[1]).toBeCloseTo(-12);
    expect(out[2]).toBeCloseTo(-2);
    expect(out[3]).toBeCloseTo(8);
    expect(out[4]).toBeCloseTo((18 + 20) / 2);
  });
});
