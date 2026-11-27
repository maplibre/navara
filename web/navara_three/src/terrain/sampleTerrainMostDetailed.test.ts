import {
  sampleQuantizedMeshHeights,
  sampleRasterDemHeights,
} from "@navaramap/engine-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuantizedMeshSource, RasterDemSource } from "../type";

import { sampleTerrainMostDetailed } from "./sampleTerrainMostDetailed";

// The worker pool package probes os.cpus at import time, which jsdom lacks;
// report "no pool" so the DEM decode falls back to the main thread (the
// quantized-mesh tests never decode images anyway).
vi.mock("@navaramap/worker", () => ({
  workerPoolStats: () => undefined,
  queueTask: vi.fn(),
}));

// The WASM math is covered by Rust unit tests; here it is mocked with a
// transparent JS model (geographic scheme, TMS y-flip, constant height per
// level) so the tests exercise the orchestration: grouping, the 404 descent,
// retries, status-code policy and aborts.
vi.mock("@navaramap/engine-api", () => {
  const tileFor = (
    geographic: boolean,
    level: number,
    lng: number,
    lat: number,
  ) => {
    const columns = (geographic ? 2 : 1) * 2 ** level;
    const rows = 2 ** level;
    const x = Math.min(
      Math.floor(((lng + Math.PI) / (2 * Math.PI)) * columns),
      columns - 1,
    );
    const y = Math.min(
      Math.floor(((Math.PI / 2 - lat) / Math.PI) * rows),
      rows - 1,
    );
    return { x, y };
  };
  return {
    default: vi.fn().mockResolvedValue(undefined),
    angleToRadian: (deg: number) => (deg * Math.PI) / 180,
    terrainPositionsToTiles: vi.fn(
      (geographic: boolean, level: number, positions: Float64Array) => {
        const result = new Uint32Array(positions.length);
        for (let i = 0; i < positions.length; i += 2) {
          const { x, y } = tileFor(
            geographic,
            level,
            positions[i],
            positions[i + 1],
          );
          result[i] = x;
          result[i + 1] = y;
        }
        return result;
      },
    ),
    terrainTileUrl: vi.fn(
      (
        template: string,
        _geographic: boolean,
        tms: boolean,
        x: number,
        y: number,
        z: number,
      ) => {
        const urlY = tms ? 2 ** z - 1 - y : y;
        return template
          .replace("{x}", String(x))
          .replace("{y}", String(urlY))
          .replace("{z}", String(z));
      },
    ),
    // Heights encode the sampled level so tests can assert which LOD won.
    sampleQuantizedMeshHeights: vi.fn(
      (
        bytes: Uint8Array,
        _geographic: boolean,
        _x: number,
        _y: number,
        z: number,
        positions: Float64Array,
      ) => {
        if (bytes.length === 0) return undefined; // undecodable payload
        return new Float64Array(positions.length / 2).fill(1000 + z);
      },
    ),
    sampleRasterDemHeights: vi.fn(),
  };
});

// Public inputs are degrees; the mocked engine functions still receive the
// radians the implementation converts to.
const KARIYA = { lat: 35.0, lng: 137.0 };
const NEARBY = { lat: 35.001, lng: 137.001 };
const TOKYO = { lat: 35.68, lng: 139.76 };

const SOURCE: QuantizedMeshSource = {
  type: "quantized-mesh",
  url: "https://terrain.test/{z}/{x}/{y}.terrain",
  maxZoom: 14,
};

/** fetch stub: tiles exist only at or below `coverageLevel`. */
function stubFetch(
  coverageLevel: number,
  overrides?: (url: string) => Response | undefined,
) {
  const seen: string[] = [];
  const mocked = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const override = overrides?.(url);
    if (override) return override;
    const z = Number(url.match(/\/(\d+)\/\d+\/\d+\.terrain/)?.[1]);
    if (z <= coverageLevel) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", mocked);
  return { seen, mocked };
}

describe("sampleTerrainMostDetailed", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns an empty array for no positions", async () => {
    await expect(sampleTerrainMostDetailed(SOURCE, [])).resolves.toEqual([]);
  });

  it("samples at maxZoom when the tile exists, without mutating the input", async () => {
    stubFetch(14);
    const input = [{ ...KARIYA }];
    const results = await sampleTerrainMostDetailed(SOURCE, input);
    expect(results).toHaveLength(1);
    expect(results[0].height).toBe(1014);
    expect(results[0].level).toBe(14);
    expect(results[0].lat).toBe(KARIYA.lat);
    expect(input[0]).toEqual(KARIYA);
    expect((input[0] as Record<string, unknown>).height).toBeUndefined();
  });

  it("descends to the deepest available level on 404", async () => {
    stubFetch(11);
    const results = await sampleTerrainMostDetailed(SOURCE, [KARIYA]);
    expect(results[0].height).toBe(1011);
    expect(results[0].level).toBe(11);
  });

  it("fetches a shared tile once for positions in the same tile", async () => {
    const { mocked } = stubFetch(14);
    const results = await sampleTerrainMostDetailed(SOURCE, [KARIYA, NEARBY]);
    // Both positions fall in the same z14 geographic tile.
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.height)).toEqual([1014, 1014]);
  });

  it("samples distant positions from their own tiles", async () => {
    const { mocked } = stubFetch(14);
    const results = await sampleTerrainMostDetailed(SOURCE, [KARIYA, TOKYO]);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.height)).toEqual([1014, 1014]);
  });

  // user: sampleTerrainMostDetailed JSDoc contract (one result per position,
  // each unique tile fetched once).
  describe("positions in different tiles that fall back to one parent", () => {
    // A z14 tile edge a quarter of the way into z12 web-mercator column 3606:
    // the two points sit in different z14 tiles but in the same z12 tile in
    // both the geographic and the web-mercator scheme.
    const EDGE_LNG = ((3606 + 0.25) / 4096) * 360 - 180;
    const WEST = { lat: 35, lng: EDGE_LNG - 0.001 };
    const EAST = { lat: 35, lng: EDGE_LNG + 0.001 };
    const BOTH_RADIANS = Float64Array.from(
      [WEST.lng, WEST.lat, EAST.lng, EAST.lat].map((d) => (d * Math.PI) / 180),
    );
    const DEM_SOURCE: RasterDemSource = {
      type: "raster-dem",
      url: SOURCE.url,
      maxZoom: 14,
    };

    /** Main-thread image decode stubs and a DEM sampler of `2000 + z`. */
    function stubDemDecode() {
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => ({ width: 1, height: 1, close: () => {} })),
      );
      vi.stubGlobal(
        "OffscreenCanvas",
        class {
          getContext() {
            return {
              drawImage: () => {},
              getImageData: () => ({ data: new Uint8ClampedArray(4) }),
            };
          }
        },
      );
      vi.mocked(sampleRasterDemHeights).mockImplementation(
        (_rgba, _decoder, _x, _y, z, positions) =>
          new Float64Array(positions.length / 2).fill(2000 + z),
      );
    }

    afterEach(() => {
      vi.mocked(sampleRasterDemHeights).mockReset();
    });

    it("samples both from the parent fetched once (quantized-mesh)", async () => {
      const { seen } = stubFetch(12);
      const results = await sampleTerrainMostDetailed(SOURCE, [WEST, EAST]);
      expect(seen.filter((url) => url.includes("/14/"))).toHaveLength(2);
      expect(seen.filter((url) => url.includes("/12/"))).toHaveLength(1);
      expect(results.map((r) => [r.height, r.level])).toEqual([
        [1012, 12],
        [1012, 12],
      ]);
    });

    it("samples both from the parent fetched once (raster-dem)", async () => {
      stubDemDecode();
      const { seen } = stubFetch(12);
      const results = await sampleTerrainMostDetailed(DEM_SOURCE, [WEST, EAST]);
      expect(seen.filter((url) => url.includes("/14/"))).toHaveLength(2);
      expect(seen.filter((url) => url.includes("/12/"))).toHaveLength(1);
      expect(results.map((r) => [r.height, r.level])).toEqual([
        [2012, 12],
        [2012, 12],
      ]);
    });

    it("decodes the parent once with both positions (quantized-mesh)", async () => {
      stubFetch(12);
      await sampleTerrainMostDetailed(SOURCE, [WEST, EAST]);
      expect(sampleQuantizedMeshHeights).toHaveBeenCalledOnce();
      expect(vi.mocked(sampleQuantizedMeshHeights).mock.calls[0][5]).toEqual(
        BOTH_RADIANS,
      );
    });

    it("decodes the parent once with both positions (raster-dem)", async () => {
      stubDemDecode();
      stubFetch(12);
      await sampleTerrainMostDetailed(DEM_SOURCE, [WEST, EAST]);
      expect(sampleRasterDemHeights).toHaveBeenCalledOnce();
      expect(vi.mocked(sampleRasterDemHeights).mock.calls[0][5]).toEqual(
        BOTH_RADIANS,
      );
    });
  });

  it("reports undefined heights for a tile whose body fails mid-stream", async () => {
    // A connection lost after the 200 headers is a network error: no height
    // for that tile's positions, and the other tiles still sample.
    const kariyaColumn = Math.floor(((KARIYA.lng + 180) / 360) * 2 ** 15);
    stubFetch(14, (url) =>
      url.includes(`/14/${kariyaColumn}/`)
        ? new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError("connection reset"));
              },
            }),
            { status: 200 },
          )
        : undefined,
    );
    const results = await sampleTerrainMostDetailed(SOURCE, [KARIYA, TOKYO]);
    expect(results.map((r) => [r.height, r.level])).toEqual([
      [undefined, undefined],
      [1014, 14],
    ]);
  });

  it("keeps a fixed options.level from falling back to parents", async () => {
    const { seen } = stubFetch(10);
    const results = await sampleTerrainMostDetailed(SOURCE, [KARIYA], {
      level: 12,
    });
    expect(results[0].height).toBeUndefined();
    expect(results[0].level).toBeUndefined();
    expect(seen.every((url) => url.includes("/12/"))).toBe(true);
  });

  it("rejects on 401/403 instead of silently coarsening", async () => {
    stubFetch(14, () => new Response(null, { status: 403 }));
    await expect(sampleTerrainMostDetailed(SOURCE, [KARIYA])).rejects.toThrow(
      /403/,
    );
  });

  it("retries 5xx and then reports undefined heights", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response(null, { status: 503 });
      }),
    );
    const results = await sampleTerrainMostDetailed(SOURCE, [KARIYA]);
    expect(results[0].height).toBeUndefined();
    // Initial attempt + 2 retries for the deepest level, and no descent to a
    // parent — a persistent server error is not "tile missing".
    expect(calls).toBe(3);
  });

  it("sends the quantized-mesh Accept header and the bearer token", async () => {
    const { mocked } = stubFetch(14);
    await sampleTerrainMostDetailed({ ...SOURCE, token: "secret" }, [KARIYA]);
    const call = mocked.mock.calls[0] as unknown as [string, RequestInit];
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Accept).toContain("application/vnd.quantized-mesh");
    expect(headers.Authorization).toBe("Bearer secret");
  });

  it("rejects when already aborted", async () => {
    stubFetch(14);
    const controller = new AbortController();
    controller.abort();
    await expect(
      sampleTerrainMostDetailed(SOURCE, [KARIYA], {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("marks heights undefined when the payload does not decode", async () => {
    // 200 with an empty body: the mocked sampler returns undefined for it.
    stubFetch(14, () => new Response(new Uint8Array(0), { status: 200 }));
    const results = await sampleTerrainMostDetailed(SOURCE, [KARIYA]);
    expect(results[0].height).toBeUndefined();
  });

  it("requires source.url", async () => {
    await expect(
      sampleTerrainMostDetailed({ type: "quantized-mesh", url: "" }, [KARIYA]),
    ).rejects.toThrow(/url/);
  });
});
