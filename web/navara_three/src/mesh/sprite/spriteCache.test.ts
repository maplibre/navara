import { describe, expect, it, vi } from "vitest";

import type { AtlasImage } from "./billboardAtlas";
import {
  type LoadSpriteSheet,
  SpriteCache,
  type SpriteSheetData,
  spriteSheetUrls,
} from "./spriteCache";

/** A `width` × `height` sheet whose pixel at top-down (x, y) has red = x and
 *  green = y; rows are stored bottom first, as the atlas loader decodes. */
const gradientSheet = (width: number, height: number): AtlasImage => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const i = (row * width + x) * 4;
      data.set([x, y, 0, 255], i);
    }
  }
  return { width, height, data };
};

/** Top-down (x, y) of the pixel at stored (column, row) of an icon. */
const pixelAt = (image: AtlasImage, column: number, row: number) => {
  const i = (row * image.width + column) * 4;
  return [image.data[i], image.data[i + 1]];
};

const sheet = (index: Record<string, unknown>): SpriteSheetData => ({
  index,
  image: gradientSheet(16, 16),
});

const loaderOf = (sheets: Record<string, SpriteSheetData | Error>) =>
  vi.fn<LoadSpriteSheet>(async ({ json }) => {
    const data = sheets[json];
    if (!data) throw new Error(`unexpected ${json}`);
    if (data instanceof Error) throw data;
    return data;
  });

describe("spriteSheetUrls", () => {
  it("puts @2x and the extension before the query and fragment", () => {
    expect(spriteSheetUrls("https://a/sprite", false)).toEqual({
      json: "https://a/sprite.json",
      image: "https://a/sprite.png",
    });
    expect(spriteSheetUrls("/s/sprite?k=1#f", true)).toEqual({
      json: "/s/sprite@2x.json?k=1#f",
      image: "/s/sprite@2x.png?k=1#f",
    });
  });
});

describe("SpriteCache", () => {
  it("cuts an icon top-down from a bottom-first sheet", async () => {
    const load = loaderOf({
      "/s.json": sheet({ dot: { x: 2, y: 3, width: 4, height: 5 } }),
    });
    const icons = await new SpriteCache(load).get(
      [{ id: "default", url: "/s" }],
      1,
    );
    const icon = icons.get("dot");
    if (!icon) throw new Error("dot is missing");
    expect(icon).toMatchObject({
      width: 4,
      height: 5,
      pixelRatio: 1,
      sdf: false,
    });
    // Stored row 0 is the icon's bottom row: sheet y = 3 + 5 - 1.
    expect(pixelAt(icon, 0, 0)).toEqual([2, 7]);
    expect(pixelAt(icon, 3, 4)).toEqual([5, 3]);
    expect(icons.get("dot")).toBe(icon);
  });

  it("names icons <id>:<name> except in the default sheet", async () => {
    const load = loaderOf({
      "/base.json": sheet({ a: { x: 0, y: 0, width: 1, height: 1 } }),
      "/maki.json": sheet({ b: { x: 0, y: 0, width: 1, height: 1 } }),
    });
    const icons = await new SpriteCache(load).get(
      [
        { id: "default", url: "/base" },
        { id: "maki", url: "/maki" },
      ],
      1,
    );
    expect(icons.get("a")).toBeDefined();
    expect(icons.get("maki:b")).toBeDefined();
    expect(icons.get("b")).toBeUndefined();
  });

  it("loads @2x sheets above pixel ratio 1 and keeps the index's ratio", async () => {
    const load = loaderOf({
      "/s@2x.json": sheet({
        dot: { x: 0, y: 0, width: 4, height: 4, pixelRatio: 2 },
      }),
    });
    const icons = await new SpriteCache(load).get(
      [{ id: "default", url: "/s" }],
      1.5,
    );
    expect(icons.get("dot")?.pixelRatio).toBe(2);
  });

  it("marks icons whose index entry has sdf: true", async () => {
    const load = loaderOf({
      "/s.json": sheet({
        dot: { x: 0, y: 0, width: 4, height: 4, sdf: true },
        flag: { x: 4, y: 0, width: 4, height: 4, sdf: "yes" },
      }),
    });
    const icons = await new SpriteCache(load).get(
      [{ id: "default", url: "/s" }],
      1,
    );
    expect(icons.get("dot")?.sdf).toBe(true);
    expect(icons.get("flag")?.sdf).toBe(false);
  });

  it("loads each sprite once, and duplicate sheets once", async () => {
    const load = loaderOf({ "/s.json": sheet({}) });
    const cache = new SpriteCache(load);
    const sheets = [
      { id: "default", url: "/s" },
      { id: "default", url: "/s" },
    ];
    const first = cache.get(sheets, 1);
    expect(cache.get([{ id: "default", url: "/s" }], 1)).toBe(first);
    await first;
    expect(load).toHaveBeenCalledTimes(1);

    // Another id for the same sheet is another sprite, but the same download.
    const renamed = await cache.get([{ id: "other", url: "/s" }], 1);
    expect(renamed).not.toBe(await first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("skips entries that are malformed or outside the sheet", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = loaderOf({
      "/s.json": sheet({
        ok: { x: 12, y: 12, width: 4, height: 4 },
        outside: { x: 13, y: 0, width: 4, height: 4 },
        empty: { x: 0, y: 0, width: 0, height: 4 },
        fraction: { x: 0.5, y: 0, width: 4, height: 4 },
        ratio: { x: 0, y: 0, width: 4, height: 4, pixelRatio: 0 },
        text: "nope",
      }),
    });
    const icons = await new SpriteCache(load).get(
      [{ id: "default", url: "/s" }],
      1,
    );
    expect(icons.get("ok")).toBeDefined();
    for (const name of ["outside", "empty", "fraction", "ratio", "text"]) {
      expect(icons.get(name)).toBeUndefined();
    }
    vi.restoreAllMocks();
  });

  it("warns once per icon name the sprite lacks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = loaderOf({ "/s.json": sheet({}) });
    const icons = await new SpriteCache(load).get(
      [{ id: "default", url: "/s" }],
      1,
    );
    icons.get("a");
    icons.get("a");
    icons.get("b");
    expect(warn.mock.calls).toEqual([
      ['Icon "a" is not in the sprite'],
      ['Icon "b" is not in the sprite'],
    ]);
    warn.mockRestore();
  });

  it("has no icons when any sheet fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = loaderOf({
      "/ok.json": sheet({ a: { x: 0, y: 0, width: 1, height: 1 } }),
      "/bad.json": new Error("404"),
    });
    const icons = await new SpriteCache(load).get(
      [
        { id: "default", url: "/ok" },
        { id: "bad", url: "/bad" },
      ],
      1,
    );
    expect(icons.get("a")).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("loads a sprite again after a sheet failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sheets: Record<string, SpriteSheetData | Error> = {
      "/s.json": new Error("timeout"),
    };
    const load = loaderOf(sheets);
    const cache = new SpriteCache(load);
    const ref = [{ id: "default", url: "/s" }];
    expect((await cache.get(ref, 1)).get("a")).toBeUndefined();

    sheets["/s.json"] = sheet({ a: { x: 0, y: 0, width: 1, height: 1 } });
    expect((await cache.get(ref, 1)).get("a")).toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
