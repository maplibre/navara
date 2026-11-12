import { describe, expect, it } from "vitest";

import {
  dilate,
  extendLevels,
  extendValues,
  fillNearestValues,
  nodeNeighbors,
  signedDistance,
  squaredDistanceTo,
} from "./derive";

const grid = (rows: string[]) =>
  Uint8Array.from(rows.join(""), (c) => (c === "#" ? 1 : 0));

describe("squaredDistanceTo", () => {
  it("matches the brute-force distance with anisotropic spacing", () => {
    const width = 7;
    const height = 5;
    const mask = grid([".......", "..#....", ".......", "......#", "......."]);
    const dx = 3;
    const dy = 2;
    const d = squaredDistanceTo(mask, width, height, dx, dy);
    for (let i = 0; i < mask.length; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      let best = Infinity;
      mask.forEach((m, j) => {
        if (!m) return;
        const sx = ((j % width) - x) * dx;
        const sy = (Math.floor(j / width) - y) * dy;
        best = Math.min(best, sx * sx + sy * sy);
      });
      expect(d[i]).toBeCloseTo(best);
    }
  });
});

describe("signedDistance", () => {
  it("puts the shoreline halfway between wet and dry cell centers", () => {
    const wet = grid(["..##.."]);
    const d = signedDistance(wet, 6, 1, 10, 10);
    expect(Array.from(d)).toEqual([15, 5, -5, -5, 5, 15]);
  });
});

describe("dilate", () => {
  it("grows the mask by one cell in all eight directions", () => {
    const out = dilate(grid(["....", ".#..", "...."]), 4, 3);
    expect(Array.from(out)).toEqual(Array.from(grid(["###.", "###.", "###."])));
  });
});

describe("extendLevels", () => {
  it("continues the surface across the domain only", () => {
    const levels = Float32Array.from([1, 3, NaN, NaN, NaN]);
    const domain = grid(["####."]);
    const out = extendLevels(levels, domain, 5, 1);
    expect(Array.from(out.subarray(0, 4))).toEqual([1, 3, 3, 3]);
    expect(out[4]).toBeNaN();
  });

  it("averages the known neighbors of a filled cell", () => {
    const levels = Float32Array.from([2, NaN, 4, NaN, NaN, NaN]);
    const domain = grid(["###", "###"]);
    const out = extendLevels(levels, domain, 3, 2);
    expect(out[1]).toBe(3);
  });
});

describe("nodeNeighbors", () => {
  it("links the nodes across the grid", () => {
    // Nodes 0 and 1 side by side, node 2 below node 1.
    const nodes = Uint32Array.from([0, 1, 3]);
    const nodeAt = Int32Array.from([0, 1, -1, 2]);
    const out = nodeNeighbors(nodes, nodeAt, 2, 2);
    expect(Array.from(out)).toEqual([
      -1, 1, -1, -1, 0, -1, -1, 2, -1, -1, 1, -1,
    ]);
  });
});

/** The neighbors of a row of nodes. */
const row = (count: number) =>
  nodeNeighbors(
    Uint32Array.from({ length: count }, (_, i) => i),
    Int32Array.from({ length: count }, (_, i) => i),
    count,
    1,
  );

describe("extendValues", () => {
  it("continues the surface across the linked nodes only", () => {
    const values = Float32Array.from([1, 3, NaN, NaN, NaN]);
    const neighbors = row(5);
    neighbors[3 * 4 + 1] = -1;
    neighbors[4 * 4] = -1;
    extendValues(values, neighbors);
    expect(Array.from(values.subarray(0, 4))).toEqual([1, 3, 3, 3]);
    expect(values[4]).toBeNaN();
  });

  it("averages the known neighbors of a filled node", () => {
    const values = Float32Array.from([2, NaN, 4]);
    extendValues(values, row(3));
    expect(values[1]).toBe(3);
  });
});

describe("fillNearestValues", () => {
  it("copies a known neighbor, so categories stay whole", () => {
    const values = Float32Array.from([1, NaN, NaN, 3]);
    fillNearestValues(values, row(4));
    expect([...values]).toEqual([1, 1, 3, 3]);
  });

  it("leaves unreachable nodes", () => {
    const values = Float32Array.from([1, NaN, NaN]);
    const neighbors = row(3);
    neighbors[1 * 4 + 1] = -1;
    neighbors[2 * 4] = -1;
    fillNearestValues(values, neighbors);
    expect([...values]).toEqual([1, 1, NaN]);
  });
});
