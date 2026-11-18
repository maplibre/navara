import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSprite, resolveIconImage, spriteSheetUrls } from "./sprite";

describe("spriteSheetUrls", () => {
  it("appends the suffixes to an absolute URL", () => {
    expect(spriteSheetUrls("https://example.com/sprite/face", false)).toEqual({
      json: "https://example.com/sprite/face.json",
      image: "https://example.com/sprite/face.png",
    });
  });

  it("puts @2x before the extension and keeps the query string", () => {
    expect(
      spriteSheetUrls("https://cdn.example.com/s/sprite?key=1", true),
    ).toEqual({
      json: "https://cdn.example.com/s/sprite@2x.json?key=1",
      image: "https://cdn.example.com/s/sprite@2x.png?key=1",
    });
  });

  it("rejects a relative URL, as MapLibre does", () => {
    expect(() => spriteSheetUrls("../sprite/face", false)).toThrow(
      'Invalid sprite URL "../sprite/face", must be absolute.',
    );
  });
});

describe("loadSprite", () => {
  /** Serves `files` by URL; anything else is a 404. */
  function stubFetch(files: Record<string, unknown>) {
    const fetchMock = vi.fn((url: string) => {
      const body = files[url];
      return Promise.resolve(
        body === undefined
          ? { ok: false, status: 404, statusText: "Not Found" }
          : {
              ok: true,
              json: () => Promise.resolve(body),
              blob: () => Promise.resolve(new Blob([url])),
            },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /**
   * jsdom has neither `createImageBitmap` nor a 2D canvas: the decoded sheet
   * is a stand-in, and a cut's data URL names the source rect it was drawn
   * from (`data:x,y,w,h`).
   */
  let toDataURL: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal("createImageBitmap", (blob: Blob) => Promise.resolve(blob));
    let drawn: number[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: (_sheet: unknown, ...rect: number[]) => {
        drawn = rect.slice(0, 4);
      },
    } as never);
    toDataURL = vi.fn(() => `data:${drawn.join(",")}`);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
      toDataURL as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const face = { x: 0, y: 0, width: 165, height: 153, pixelRatio: 1 };
  const A = "https://example.com/a";
  const B = "https://example.com/b";

  it("cuts an icon out of the sheet on first use only", async () => {
    stubFetch({
      "https://example.com/a.json": {
        face,
        sad: { ...face, x: 165 },
      },
      "https://example.com/a.png": "png",
    });

    const images = await loadSprite(A, 1);
    expect(toDataURL).not.toHaveBeenCalled();

    expect(images.get("sad")).toEqual({
      url: "data:165,0,165,153",
      pixelRatio: 1,
    });
    images.get("sad");
    expect(toDataURL).toHaveBeenCalledTimes(1);
    expect(images.get("missing")).toBeUndefined();
  });

  it("loads the @2x sheet above pixel ratio 1", async () => {
    stubFetch({
      "https://example.com/a@2x.json": {
        face: { x: 0, y: 0, width: 330, height: 306, pixelRatio: 2 },
      },
      "https://example.com/a@2x.png": "png",
    });

    const images = await loadSprite(A, 2);

    expect(images.get("face")).toEqual({
      url: "data:0,0,330,306",
      pixelRatio: 2,
    });
  });

  it("does not fall back to the 1x sheet when @2x is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = stubFetch({
      "https://example.com/a.json": { face },
      "https://example.com/a.png": "png",
    });

    const images = await loadSprite(A, 2);

    expect(images.get("face")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalledWith("https://example.com/a.json");
  });

  it("prefixes names with the sprite id, except for 'default'", async () => {
    stubFetch({
      "https://example.com/a.json": { pin: face },
      "https://example.com/a.png": "png",
      "https://example.com/b.json": { pin: { ...face, x: 10 } },
      "https://example.com/b.png": "png",
    });

    const images = await loadSprite(
      [
        { id: "default", url: A },
        { id: "extra", url: B },
      ],
      1,
    );

    expect(images.get("pin")?.url).toBe("data:0,0,165,153");
    expect(images.get("extra:pin")?.url).toBe("data:10,0,165,153");
  });

  it("loads identical id + url entries once", async () => {
    const fetchMock = stubFetch({
      "https://example.com/a.json": { face },
      "https://example.com/a.png": "png",
    });

    await loadSprite(
      [
        { id: "default", url: A },
        { id: "default", url: A },
      ],
      1,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses none of the sprites when any fails, warning about each", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch({
      "https://example.com/a.json": { pin: face },
      "https://example.com/a.png": "png",
    });

    const images = await loadSprite(
      [
        { id: "default", url: A },
        { id: "one", url: "https://example.com/one" },
        { id: "two", url: "https://example.com/two" },
      ],
      1,
    );

    expect(images.get("pin")).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      'Failed to load sprite "https://example.com/one":',
      expect.any(Error),
    );
    expect(console.warn).toHaveBeenCalledWith(
      'Failed to load sprite "https://example.com/two":',
      expect.any(Error),
    );
  });

  it("rejects a relative sprite URL with a warning", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch({});

    const images = await loadSprite("../sprite/face", 1);

    expect(images.get("face")).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'Failed to load sprite "../sprite/face":',
      expect.objectContaining({ message: expect.stringContaining("absolute") }),
    );
  });

  it("ignores malformed and empty index entries; pixelRatio defaults to 1", async () => {
    stubFetch({
      "https://example.com/a.json": {
        ok: { x: 1, y: 2, width: 3, height: 4 },
        empty: { x: 0, y: 0, width: 0, height: 4, pixelRatio: 1 },
        broken: { x: "0" },
        negativeRatio: { x: 0, y: 0, width: 3, height: 4, pixelRatio: -2 },
        stringRatio: { x: 0, y: 0, width: 3, height: 4, pixelRatio: "x" },
      },
      "https://example.com/a.png": "png",
    });

    const images = await loadSprite(A, 1);

    expect(images.get("ok")).toEqual({ url: "data:1,2,3,4", pixelRatio: 1 });
    expect(images.get("empty")).toBeUndefined();
    expect(images.get("broken")).toBeUndefined();
    expect(images.get("negativeRatio")).toBeUndefined();
    expect(images.get("stringRatio")).toBeUndefined();
  });
});

describe("resolveIconImage", () => {
  const sprite = new Map([["pin", { url: "data:pin", pixelRatio: 2 }]]);

  it("looks names up in the sprite, which has no fallback", () => {
    expect(resolveIconImage("pin", sprite)).toEqual({
      url: "data:pin",
      pixelRatio: 2,
    });
    expect(resolveIconImage("/icons/a.png", sprite)).toBeUndefined();
    // A sprite still loading, or one that failed, is empty.
    expect(resolveIconImage("pin", new Map())).toBeUndefined();
  });

  it("reads the name as an image URL when the style has no sprite", () => {
    expect(resolveIconImage("/icons/a.png", undefined)).toEqual({
      url: "/icons/a.png",
      pixelRatio: 1,
    });
  });
});
