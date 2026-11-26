import { describe, expect, it, vi } from "vitest";

import {
  type AtlasImage,
  type AtlasRect,
  BillboardAtlas,
} from "./billboardAtlas";

/** Solid-color RGBA image where every pixel is (r, g, b, 255). */
const solidImage = (
  width: number,
  height: number,
  r: number,
  g = 0,
  b = 0,
): AtlasImage => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
};

/** loadImage stub: url "WxH:r" resolves to a solid image of that size/color. */
const stubLoader = () =>
  vi.fn(async (url: string): Promise<AtlasImage> => {
    const [size, r] = url.split(":");
    const [w, h] = size.split("x").map(Number);
    return solidImage(w, h, Number(r ?? 0));
  });

const overlaps = (a: AtlasRect, b: AtlasRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** pack() that fails the test instead of resolving undefined. */
const mustPack = async (
  atlas: BillboardAtlas,
  url: string,
): Promise<AtlasRect> => {
  const rect = await atlas.pack(url);
  if (!rect) throw new Error(`pack failed for ${url}`);
  return rect;
};

describe("BillboardAtlas", () => {
  it("packs an image and returns its pixel rect", async () => {
    const atlas = new BillboardAtlas({
      initialSize: 64,
      loadImage: stubLoader(),
    });
    const rect = await mustPack(atlas, "16x8:255");

    expect(rect.w).toBe(16);
    expect(rect.h).toBe(8);
    expect(rect.x + rect.w).toBeLessThanOrEqual(atlas.size);
    expect(rect.y + rect.h).toBeLessThanOrEqual(atlas.size);
    expect(rect.pixelRatio).toBe(1);
    expect(rect.sdf).toBe(false);
  });

  it("carries the image's pixel ratio and SDF flag on its rect", async () => {
    const atlas = new BillboardAtlas({
      initialSize: 64,
      loadImage: async () => ({
        ...solidImage(8, 8, 0),
        pixelRatio: 2,
        sdf: true,
      }),
    });
    expect(await mustPack(atlas, "icon")).toMatchObject({
      pixelRatio: 2,
      sdf: true,
    });
  });

  it("writes the image pixels at the rect position", async () => {
    const atlas = new BillboardAtlas({
      initialSize: 64,
      loadImage: stubLoader(),
    });
    const rect = await mustPack(atlas, "4x4:200");

    const data = atlas.texture.image.data as Uint8Array;
    // Sample the rect's first and last pixels.
    const first = (rect.y * atlas.size + rect.x) * 4;
    const last = ((rect.y + rect.h - 1) * atlas.size + rect.x + rect.w - 1) * 4;
    expect(data[first]).toBe(200);
    expect(data[first + 3]).toBe(255);
    expect(data[last]).toBe(200);
    // One past the rect horizontally is gutter: untouched (transparent).
    const gutter = (rect.y * atlas.size + rect.x + rect.w) * 4;
    expect(data[gutter + 3]).toBe(0);
  });

  it("dedupes by URL, including in-flight loads", async () => {
    const loadImage = stubLoader();
    const atlas = new BillboardAtlas({ initialSize: 64, loadImage });

    const [a, b] = await Promise.all([
      atlas.pack("8x8:1"),
      atlas.pack("8x8:1"),
    ]);
    const c = await atlas.pack("8x8:1");

    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it("packs distinct images into non-overlapping rects", async () => {
    const atlas = new BillboardAtlas({
      initialSize: 64,
      loadImage: stubLoader(),
    });
    const rects = await Promise.all([
      mustPack(atlas, "16x16:1"),
      mustPack(atlas, "8x4:2"),
      mustPack(atlas, "20x12:3"),
      mustPack(atlas, "3x30:4"),
    ]);

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it("grows when full and keeps existing rects and pixels valid", async () => {
    const atlas = new BillboardAtlas({
      initialSize: 16,
      maxSize: 64,
      loadImage: stubLoader(),
    });

    const small = await mustPack(atlas, "8x8:11");
    const initialTexture = atlas.texture;
    expect(atlas.size).toBe(16);

    // Doesn't fit in the remaining 16x16 space: forces growth.
    const big = await mustPack(atlas, "20x20:22");

    expect(atlas.size).toBeGreaterThan(16);
    expect(atlas.texture).not.toBe(initialTexture);
    expect(overlaps(small, big)).toBe(false);

    // The first image's pixels survived the copy into the larger buffer.
    const data = atlas.texture.image.data as Uint8Array;
    const first = (small.y * atlas.size + small.x) * 4;
    expect(data[first]).toBe(11);
  });

  it("returns undefined when an image cannot fit even at maxSize", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const atlas = new BillboardAtlas({
      initialSize: 16,
      maxSize: 32,
      loadImage: stubLoader(),
    });

    expect(await atlas.pack("64x64:0")).toBeUndefined();
    warn.mockRestore();
  });

  it("reports its footprint as CPU buffer + GPU texture and tracks growth", async () => {
    const atlas = new BillboardAtlas({
      initialSize: 16,
      maxSize: 64,
      loadImage: stubLoader(),
    });
    // 16×16 RGBA, twice (CPU pixel buffer + GPU copy).
    expect(atlas.byteLength).toBe(16 * 16 * 4 * 2);

    // Forces growth to 32 (20+gutter doesn't fit in 16).
    await mustPack(atlas, "20x20:0");
    expect(atlas.byteLength).toBe(32 * 32 * 4 * 2);
  });

  it("caches failed loads and resolves them as undefined", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loadImage = vi.fn(async (): Promise<AtlasImage> => {
      throw new Error("404");
    });
    const atlas = new BillboardAtlas({ initialSize: 16, loadImage });

    expect(await atlas.pack("bad")).toBeUndefined();
    expect(await atlas.pack("bad")).toBeUndefined();
    expect(loadImage).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
