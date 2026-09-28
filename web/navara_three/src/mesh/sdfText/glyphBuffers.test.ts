import { describe, expect, test } from "vitest";

import { backgroundSliceCount, GlyphBuffers, GlyphKind } from "./glyphBuffers";
import type { GlyphQuad } from "./layout";

const quad = (i: number): GlyphQuad =>
  ({
    isColor: false,
    offsetEmX: i,
    offsetEmY: 0,
    sizeEmX: 1,
    sizeEmY: 1,
    uvL: 0,
    uvT: 0,
    uvR: 1,
    uvB: 1,
  }) as GlyphQuad;

const attr = (buffers: GlyphBuffers, name: string) =>
  buffers.geometry.getAttribute(name).array as Float32Array;

describe("backgroundSliceCount", () => {
  test("one strip per two glyphs, at least one, capped", () => {
    expect(backgroundSliceCount(0)).toBe(1);
    expect(backgroundSliceCount(1)).toBe(1);
    expect(backgroundSliceCount(2)).toBe(1);
    expect(backgroundSliceCount(3)).toBe(2);
    expect(backgroundSliceCount(14)).toBe(7);
    expect(backgroundSliceCount(100)).toBe(8);
  });
});

describe("GlyphBuffers.writeRun background strips", () => {
  test("strips lead the run and tile [0, 1] with shared edges", () => {
    const buffers = new GlyphBuffers(32);
    const quads = Array.from({ length: 7 }, (_, i) => quad(i));
    const slices = backgroundSliceCount(quads.length);
    buffers.writeRun(0, slices + quads.length, 5, quads, true);

    const kind = attr(buffers, "glyphKind");
    const offset = attr(buffers, "glyphOffset");
    const size = attr(buffers, "glyphSize");

    for (let i = 0; i < slices; i++) {
      expect(kind[i]).toBe(GlyphKind.BACKGROUND);
      // Start in offset.x, end in size.x.
      const start = offset[i * 2];
      const end = size[i * 2];
      expect(start).toBe(i === 0 ? 0 : size[(i - 1) * 2]);
      expect(end).toBeGreaterThan(start);
    }
    expect(size[(slices - 1) * 2]).toBe(1);

    // The glyphs follow the strips, in order.
    for (let i = 0; i < quads.length; i++) {
      expect(kind[slices + i]).toBe(GlyphKind.SDF);
      expect(offset[(slices + i) * 2]).toBe(i);
    }
  });
});
