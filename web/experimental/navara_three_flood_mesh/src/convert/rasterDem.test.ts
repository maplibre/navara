// @vitest-environment node
// sharp and the engine's WASM are read as Node reads them.
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sampleRasterDemMostDetailed, terrainSamplerOf } from "./rasterDem";
import type { RasterDemTerrain } from "./terrain";

describe("sampleRasterDemMostDetailed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Serves 4 × 4 pixel Terrain-RGB tiles whose height is 100 m plus 10 m
   * per pixel column, at `zoom` only: other levels are missing.
   */
  const serve = async (zoom: number) => {
    const rgb = Uint8Array.from({ length: 4 * 4 * 3 }, (_, i) => {
      const value = Math.round(
        (100 + 10 * (Math.floor(i / 3) % 4) + 10000) * 10,
      );
      return [value >> 16, (value >> 8) & 255, value & 255][i % 3];
    });
    const png = await sharp(rgb, { raw: { width: 4, height: 4, channels: 3 } })
      .png()
      .toBuffer();
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return Promise.resolve(
        url.startsWith(`https://dem/${zoom}/`)
          ? new Response(new Uint8Array(png), {
              headers: { "content-type": "image/png" },
            })
          : new Response(null, { status: 404 }),
      );
    });
    return urls;
  };

  it("decodes and interpolates the most detailed tile there is", async () => {
    const urls = await serve(3);
    // Zoom 3 tiles are 45° wide, their pixels spread edge to edge: 0° is
    // the west edge of tile 4, at column 0, and 22.5° its middle, between
    // columns 1 and 2.
    const [west, middle] = await sampleRasterDemMostDetailed(
      {
        type: "raster-dem",
        url: "https://dem/{z}/{x}/{y}.png",
        elevationDecoder: "mapbox",
        maxZoom: 5,
      },
      [
        { lng: 0.001, lat: 10 },
        { lng: 22.5, lat: 10 },
      ],
    );
    expect(west.height).toBeCloseTo(100, 2);
    expect(middle.height).toBeCloseTo(115, 3);
    // Down from zoom 5 where missing, a parent both share fetched once.
    expect(urls.sort()).toEqual([
      "https://dem/3/4/3.png",
      "https://dem/4/8/7.png",
      "https://dem/4/9/7.png",
      "https://dem/5/16/15.png",
      "https://dem/5/18/15.png",
    ]);
  });

  it("refuses a decoder the engine does not have", async () => {
    await serve(3);
    await expect(
      sampleRasterDemMostDetailed(
        {
          type: "raster-dem",
          url: "https://dem/{z}/{x}/{y}.png",
          elevationDecoder: "gsi" as "mapbox",
          maxZoom: 3,
        },
        [{ lng: 0, lat: 0 }],
      ),
    ).rejects.toThrow('is none of "japanGSI", "mapbox", "terrarium"');
  });
});

describe("terrainSamplerOf", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("samples a raster-dem source", async () => {
    // A 1 × 1 pixel Terrain-RGB tile of 42 m everywhere.
    const value = (42 + 10000) * 10;
    const png = await sharp(
      Uint8Array.from([value >> 16, (value >> 8) & 255, value & 255]),
      { raw: { width: 1, height: 1, channels: 3 } },
    )
      .png()
      .toBuffer();
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(new Uint8Array(png), {
          headers: { "content-type": "image/png" },
        }),
      ),
    );
    const sample = terrainSamplerOf({
      type: "raster-dem",
      url: "https://dem/{z}/{x}/{y}.png",
      elevationDecoder: "mapbox",
      maxZoom: 2,
    });
    const [{ height }] = await sample([{ lng: 139, lat: 35 }]);
    expect(height).toBeCloseTo(42, 3);
  });

  it("passes a sampler through", () => {
    const sampler = () => Promise.resolve([]);
    expect(terrainSamplerOf(sampler)).toBe(sampler);
  });

  it("refuses a source without its decoder", () => {
    expect(() =>
      terrainSamplerOf({
        type: "raster-dem",
        url: "https://dem/{z}/{x}/{y}.png",
      } as RasterDemTerrain),
    ).toThrow("needs its elevationDecoder");
  });
});
