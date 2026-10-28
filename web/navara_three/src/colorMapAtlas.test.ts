import { describe, expect, it, vi } from "vitest";

import { ColorMapAtlas } from "./colorMapAtlas";

type AtlasImage = { width: number; height: number; data: Float32Array };

const image = (atlas: ColorMapAtlas) => atlas.getTexture().image as AtlasImage;

/** Stop i of `row`: [premultiplied RGBA, position]. */
const stop = (atlas: ColorMapAtlas, row: number, i: number) => {
  const { width, data } = image(atlas);
  const color = (row * width + i * 2) * 4;
  return {
    color: Array.from(data.slice(color, color + 4)),
    position: data[color + 4],
  };
};

const rgba = (...entries: number[][]) => new Float32Array(entries.flat());

describe("ColorMapAtlas", () => {
  it("has a default grayscale row so the texture is never empty", () => {
    const atlas = new ColorMapAtlas();
    expect(image(atlas).height).toBe(1);
    expect(atlas.getRow(undefined)).toEqual({
      row: 0,
      stopCount: 2,
      hasColorStops: false,
    });
    expect(atlas.getRow("unknown").row).toBe(0);
    expect(stop(atlas, 0, 0)).toEqual({ color: [0, 0, 0, 1], position: 0 });
    expect(stop(atlas, 0, 1)).toEqual({ color: [1, 1, 1, 1], position: 1 });
  });

  it("spaces a plain colorMap evenly over 0..1", () => {
    const atlas = new ColorMapAtlas();
    atlas.setColorMap("a", rgba([1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]));
    expect(atlas.getRow("a")).toEqual({
      row: 1,
      stopCount: 3,
      hasColorStops: false,
    });
    expect([0, 1, 2].map((i) => stop(atlas, 1, i).position)).toEqual([
      0, 0.5, 1,
    ]);
  });

  it("places colorStops at their elevations", () => {
    const atlas = new ColorMapAtlas();
    atlas.setColorMap(
      "relief",
      rgba([0, 1, 0, 1], [1, 1, 0, 1], [1, 1, 1, 1]),
      new Float32Array([0, 100, 3000]),
    );
    expect(atlas.getRow("relief").hasColorStops).toBe(true);
    expect([0, 1, 2].map((i) => stop(atlas, 1, i).position)).toEqual([
      0, 100, 3000,
    ]);
  });

  it("stores colors premultiplied", () => {
    const atlas = new ColorMapAtlas();
    atlas.setColorMap("a", rgba([1, 0.5, 0, 0.5], [0, 0, 0, 0]));
    expect(stop(atlas, 1, 0).color).toEqual([0.5, 0.25, 0, 0.5]);
    expect(stop(atlas, 1, 1).color).toEqual([0, 0, 0, 0]);
  });

  it("pads a single stop to two of the same color", () => {
    const atlas = new ColorMapAtlas();
    atlas.setColorMap("a", rgba([0, 1, 0, 1]), new Float32Array([500]));
    expect(atlas.getRow("a").stopCount).toBe(2);
    expect(stop(atlas, 1, 0)).toEqual({ color: [0, 1, 0, 1], position: 500 });
    expect(stop(atlas, 1, 1)).toEqual({ color: [0, 1, 0, 1], position: 501 });
  });

  it("sizes the texture for the longest ramp", () => {
    const atlas = new ColorMapAtlas();
    atlas.setColorMap("a", rgba(...Array(5).fill([1, 1, 1, 1])));
    atlas.setColorMap("b", rgba([0, 0, 0, 1], [1, 1, 1, 1]));
    const { width, height } = image(atlas);
    expect(width).toBe(10); // 5 stops x (color + position)
    expect(height).toBe(3); // default + 2
  });

  it("subsamples an oversized ramp so the atlas stays within 2048 texels", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const atlas = new ColorMapAtlas();
    const n = 3000;
    const colorMap = new Float32Array(n * 4);
    const colorStops = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      colorMap.set([i / (n - 1), 0, 0, 1], i * 4);
      colorStops[i] = i * 10;
    }
    atlas.setColorMap("big", colorMap, colorStops);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("3000 entries"));
    expect(atlas.getRow("big").stopCount).toBe(1024);
    expect(image(atlas).width).toBe(2048);
    // Both ends are kept exactly.
    expect(stop(atlas, 1, 0)).toEqual({ color: [0, 0, 0, 1], position: 0 });
    expect(stop(atlas, 1, 1023)).toEqual({
      color: [1, 0, 0, 1],
      position: (n - 1) * 10,
    });
    warn.mockRestore();
  });

  it("ignores colorStops that do not pair with the colorMap or do not ascend", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const atlas = new ColorMapAtlas();
    const colorMap = rgba([0, 0, 0, 1], [1, 1, 1, 1]);
    atlas.setColorMap("short", colorMap, new Float32Array([0]));
    atlas.setColorMap("desc", colorMap, new Float32Array([10, 0]));
    expect(atlas.getRow("short").hasColorStops).toBe(false);
    expect(atlas.getRow("desc").hasColorStops).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("rejects a flattened RGB array and falls back to the default row", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const atlas = new ColorMapAtlas();
    atlas.setColorMap(
      "rgb",
      new Float32Array([0, 0, 0, 1, 1, 1, 0.5, 0.5, 0.5]),
    );
    expect(atlas.has("rgb")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"rgb"'));
    warn.mockRestore();
  });

  it("assigns rows in insertion order and shifts them on removal", () => {
    const atlas = new ColorMapAtlas();
    const colorMap = rgba([0, 0, 0, 1], [1, 1, 1, 1]);
    atlas.setColorMap("a", colorMap);
    atlas.setColorMap("b", colorMap);
    expect(atlas.getRow("a").row).toBe(1);
    expect(atlas.getRow("b").row).toBe(2);
    atlas.setColorMap("a", undefined);
    expect(atlas.getRow("a").row).toBe(0);
    expect(atlas.getRow("b").row).toBe(1);
  });

  it("reports whether setColorMap changed the atlas", () => {
    const atlas = new ColorMapAtlas();
    const colorMap = () => rgba([0, 0, 0, 1], [1, 1, 1, 1]);
    expect(atlas.setColorMap("a", colorMap())).toBe(true);
    // Same values in fresh arrays: no change, no rebuild.
    const texture = atlas.getTexture();
    expect(atlas.setColorMap("a", colorMap())).toBe(false);
    expect(atlas.getTexture()).toBe(texture);
    expect(atlas.setColorMap("a", colorMap(), new Float32Array([0, 1]))).toBe(
      true,
    );
    expect(atlas.setColorMap("a", colorMap(), new Float32Array([0, 1]))).toBe(
      false,
    );
    expect(atlas.setColorMap("a", undefined)).toBe(true);
    expect(atlas.setColorMap("a", undefined)).toBe(false);
  });

  it("keeps its own copy of the arrays", () => {
    const atlas = new ColorMapAtlas();
    const colorMap = rgba([0, 0, 0, 1], [1, 1, 1, 1]);
    atlas.setColorMap("a", colorMap);
    colorMap[0] = 0.5; // caller mutates in place, then re-submits
    expect(atlas.setColorMap("a", colorMap)).toBe(true);
    expect(atlas.get("a")?.colorMap).not.toBe(colorMap);
  });

  it("frees everything on dispose", () => {
    const atlas = new ColorMapAtlas();
    atlas.setColorMap("a", rgba([0, 0, 0, 1], [1, 1, 1, 1]));
    atlas.getTexture();
    atlas.dispose();
    expect(atlas.has("a")).toBe(false);
    expect(image(atlas).height).toBe(1);
  });
});
