import { describe, expect, it } from "vitest";

import { summarize } from "./overdrawView";

/** RGBA bytes with the given counts in red. */
function pixels(counts: number[]): Uint8Array {
  const rgba = new Uint8Array(counts.length * 4);
  counts.forEach((c, i) => (rgba[i * 4] = c));
  return rgba;
}

describe("summarize", () => {
  it("totals the fragments and finds the maximum", () => {
    const s = summarize(pixels([0, 1, 1, 3, 255]));
    expect(s.pixels).toBe(5);
    expect(s.covered).toBe(4);
    expect(s.fragments).toBe(260);
    expect(s.max).toBe(255);
  });

  it("puts each pixel in its band", () => {
    // Bands start at 0, 1, 2, 3, 4, 6, 9, 16, 32, 64.
    const s = summarize(
      pixels([0, 1, 2, 3, 4, 5, 6, 8, 9, 15, 16, 31, 32, 63, 64, 200]),
    );
    expect(s.bands).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
  });
});
