import { describe, expect, it } from "vitest";

import {
  CELL,
  CELLS,
  TEXTURE_SIZE,
  WINDOW_X,
  WINDOW_Y,
  createWindowAtlasData,
} from "./atlas";

const texel = (data: Uint8Array, x: number, y: number) => {
  const i = (y * TEXTURE_SIZE + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

describe("createWindowAtlasData", () => {
  const data = createWindowAtlasData();

  it("is deterministic", () => {
    // Index of the first texel that differs; `toEqual` on 4 MB is too slow.
    const again = createWindowAtlasData();
    expect(again.length).toBe(data.length);
    expect(again.findIndex((v, i) => v !== data[i])).toBe(-1);
  });

  it("keeps the gaps between windows dark", () => {
    const lit: string[] = [];
    for (let floor = 0; floor < CELLS; floor++) {
      for (let column = 0; column < CELLS; column++) {
        // Texel just left of the window and just above it.
        const left = texel(
          data,
          column * CELL + WINDOW_X[0] - 1,
          floor * CELL + WINDOW_Y[0],
        );
        const above = texel(
          data,
          column * CELL + WINDOW_X[0],
          floor * CELL + WINDOW_Y[0] - 1,
        );
        if (left.some((v) => v > 0) || above.some((v) => v > 0)) {
          lit.push(`${column},${floor}`);
        }
      }
    }
    expect(lit).toEqual([]);
  });

  it("lights windows cumulatively across the channels", () => {
    // A window lit at a lower level is lit, with the same brightness, at
    // every higher level.
    const broken: string[] = [];
    let litAtLowest = 0;
    for (let floor = 0; floor < CELLS; floor++) {
      for (let column = 0; column < CELLS; column++) {
        const [r, g, b, a] = texel(
          data,
          column * CELL + WINDOW_X[0],
          floor * CELL + WINDOW_Y[0],
        );
        const cumulative =
          (r === 0 || (g === r && b === r && a === r)) &&
          (g === 0 || (b === g && a === g)) &&
          (b === 0 || a === b);
        if (!cumulative) broken.push(`${column},${floor}`);
        if (r > 0) litAtLowest++;
      }
    }
    expect(broken).toEqual([]);
    expect(litAtLowest).toBeGreaterThan(0);
    expect(litAtLowest).toBeLessThan(CELLS * CELLS);
  });
});
