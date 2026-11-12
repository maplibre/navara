import { describe, expect, it } from "vitest";

import { sampleTimeSeriesFlood } from "./sample";
import { decodeTimes, loadTimeSeriesFlood, regularAxis } from "./series";

describe("decodeTimes", () => {
  it("decodes CF units with a zoned reference", () => {
    expect(
      decodeTimes([0, 90], "minutes since 2024-10-20T21:00:00Z").map((d) =>
        d.toISOString(),
      ),
    ).toEqual(["2024-10-20T21:00:00.000Z", "2024-10-20T22:30:00.000Z"]);
  });

  it("reads a reference without a zone as UTC", () => {
    expect(decodeTimes([1], "hours since 2024-10-20 21:00:00")[0]).toEqual(
      new Date("2024-10-20T22:00:00Z"),
    );
    expect(decodeTimes([2], "days since 2024-10-20")[0]).toEqual(
      new Date("2024-10-22T00:00:00Z"),
    );
  });

  it("rejects times that do not increase", () => {
    expect(() => decodeTimes([0, 0], "hours since 2024-01-01")).toThrow(
      /must increase/,
    );
    expect(() => decodeTimes([1, 0], "hours since 2024-01-01")).toThrow(
      /must increase/,
    );
  });

  it("rejects units it cannot read", () => {
    expect(() => decodeTimes([0], "fortnights since 2024-01-01")).toThrow();
    expect(() => decodeTimes([0], undefined)).toThrow();
  });
});

describe("regularAxis", () => {
  it("accepts a descending axis", () => {
    expect(regularAxis([35.9, 35.8, 35.7])).toEqual({
      start: 35.9,
      step: expect.closeTo(-0.1),
    });
  });

  it("accepts float32 rounding at fine spacing", () => {
    const values = Float32Array.from(
      { length: 1000 },
      (_, i) => 139.7 + i * 1e-4,
    );
    const axis = regularAxis(values, 2 ** -24);
    expect(axis.step).toBeCloseTo(1e-4, 8);
    expect(() => regularAxis(values)).toThrow();
  });

  it("rejects uneven spacing", () => {
    expect(() => regularAxis([0, 1, 3])).toThrow();
  });
});

/**
 * A Zarr v2 store with a null fill value over a 4 × 4 grid of 0.001° cells
 * in one frame, of which only the water levels of `chunks` (2 × 2 cells
 * each) are written.
 */
const v2Store = (chunks: Record<string, number[]>) => {
  const store = new Map<string, Uint8Array>();
  const json = (key: string, value: unknown) =>
    store.set(key, new TextEncoder().encode(JSON.stringify(value)));
  const array = (
    name: string,
    shape: number[],
    dtype: "<f4" | "<f8",
    attrs: Record<string, unknown>,
    data: Record<string, number[]>,
    chunkShape = shape,
  ) => {
    json(`/${name}/.zarray`, {
      zarr_format: 2,
      shape,
      chunks: chunkShape,
      dtype,
      compressor: null,
      fill_value: null,
      order: "C",
      filters: null,
    });
    json(`/${name}/.zattrs`, attrs);
    for (const [key, values] of Object.entries(data)) {
      const typed =
        dtype === "<f8" ? Float64Array.from(values) : Float32Array.from(values);
      store.set(`/${name}/${key}`, new Uint8Array(typed.buffer));
    }
  };
  json("/.zgroup", { zarr_format: 2 });
  array("time", [1], "<f8", { units: "hours since 2024-01-01" }, { 0: [0] });
  array("lat", [4], "<f8", {}, { 0: [35.0005, 35.0015, 35.0025, 35.0035] });
  array("lon", [4], "<f8", {}, { 0: [139.0005, 139.0015, 139.0025, 139.0035] });
  array("water_level", [1, 4, 4], "<f4", {}, chunks, [1, 2, 2]);
  return store;
};

describe("loadTimeSeriesFlood", () => {
  it("reads a chunk missing from a v2 store with a null fill value as dry", async () => {
    const series = await loadTimeSeriesFlood({
      store: v2Store({ "0.0.0": [10, 11, 12, 13] }),
    });
    expect(
      sampleTimeSeriesFlood(series, { lng: 139.0005, lat: 35.0005 }, 0)?.level,
    ).toBeCloseTo(10);
    expect(
      sampleTimeSeriesFlood(series, { lng: 139.0035, lat: 35.0035 }, 0),
    ).toBeUndefined();
  });

  it("rejects a signed distance not shaped like the water level", async () => {
    const store = v2Store({ "0.0.0": [10, 11, 12, 13] });
    for (const [key, value] of [...store]) {
      if (key.startsWith("/lat/")) {
        store.set(key.replace("/lat/", "/distance/"), value);
      }
    }
    await expect(
      loadTimeSeriesFlood({ store, variables: { signedDistance: "distance" } }),
    ).rejects.toThrow("distance must be shaped");
  });

  it("keeps the levels' precision far above the lowest", async () => {
    const series = await loadTimeSeriesFlood({
      store: v2Store({ "0.0.0": [0, 0.1, 400.03, 400.07] }),
    });
    expect(
      sampleTimeSeriesFlood(series, { lng: 139.0005, lat: 35.0015 }, 0)?.level,
    ).toBeCloseTo(400.03, 2);
  });
});
