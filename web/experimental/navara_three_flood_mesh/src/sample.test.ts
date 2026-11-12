import { beforeAll, describe, expect, it } from "vitest";

import { writeFloodZarr, type FloodZarrInfo } from "./convert/zarr";
import { frameToTime, sampleTimeSeriesFlood, timeToFrame } from "./sample";
import { loadTimeSeriesFlood, type TimeSeriesFloodSeries } from "./series";

// Three frames, an hour then two apart, over cells 0 and 1 of a row:
// cell 0 is wet in the first two, cell 1 in the last two.
const writeSeries = async () => {
  const store = new Map<string, Uint8Array>();
  const info = await writeFloodZarr(store, {
    grid: { lngStep: 0.001, latStep: 0.001, lngOffset: 0, latOffset: 0 },
    times: Float64Array.from([0, 3600, 10800]),
    frames: [
      {
        x: Int32Array.from([0]),
        y: Int32Array.from([0]),
        level: Float32Array.from([10]),
        properties: {
          ground: Float32Array.from([9]),
          speed: Float32Array.from([0.5]),
        },
      },
      {
        x: Int32Array.from([0, 1]),
        y: Int32Array.from([0, 0]),
        level: Float32Array.from([11, 10.5]),
        properties: {
          ground: Float32Array.from([9, 9.5]),
          speed: Float32Array.from([1, 0.25]),
        },
      },
      {
        x: Int32Array.from([1]),
        y: Int32Array.from([0]),
        level: Float32Array.from([10.25]),
        properties: {
          ground: Float32Array.from([9.5]),
          speed: Float32Array.from([0.25]),
        },
      },
    ],
    attributes: { ground: "ground" },
    precision: { ground: 0.01 },
    units: { speed: "m/s" },
    labels: { speed: "flow speed" },
  });
  return { store, info };
};

const cell0 = { lng: 0.0005, lat: 0.0005 };
const cell1 = { lng: 0.0015, lat: 0.0005 };

describe("loadTimeSeriesFlood", () => {
  let store: Map<string, Uint8Array>;
  let info: FloodZarrInfo;
  let series: TimeSeriesFloodSeries;
  beforeAll(async () => {
    ({ store, info } = await writeSeries());
    series = await loadTimeSeriesFlood({ store });
  });

  it("uploads as many bytes as the converter estimates", () => {
    expect(info.textureBytes.water).toBe(series.texels.byteLength);
    expect(info.textureBytes.properties.speed).toBe(
      series.fields.get("speed")?.data.byteLength,
    );
  });

  it("reads the ground height for the depth without offering it", () => {
    expect(Object.keys(series.properties).sort()).toEqual([
      "arrival",
      "depth",
      "duration",
      "rate",
      "speed",
    ]);
    expect(series.properties.depth).toMatchObject({ max: 2, units: "m" });
    expect(series.properties.speed).toMatchObject({
      max: 1,
      units: "m/s",
      label: "flow speed",
    });
  });

  it("gives the area the water reaches", () => {
    const { west, south, east, north } = series.bounds;
    expect([west, south, east, north].map((v) => v.toFixed(6))).toEqual(
      [0, 0, 0.002, 0.001].map((v) => v.toFixed(6)),
    );
  });

  it("reports its progress up to 1", async () => {
    const reported: number[] = [];
    await loadTimeSeriesFlood({ store, onProgress: (f) => reported.push(f) });
    expect(reported.length).toBeGreaterThan(1);
    expect(reported[reported.length - 1]).toBe(1);
    expect(reported).toEqual([...reported].sort((a, b) => a - b));
  });

  it("rejects once aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadTimeSeriesFlood({ store, signal: controller.signal }),
    ).rejects.toThrow();
  });

  it("survives structured cloning, as from a worker", () => {
    const clone = structuredClone(series);
    expect(sampleTimeSeriesFlood(clone, cell0, 1)).toEqual(
      sampleTimeSeriesFlood(series, cell0, 1),
    );
  });

  describe("sampleTimeSeriesFlood", () => {
    it("gives the level and the properties where wet", () => {
      const sample = sampleTimeSeriesFlood(series, cell0, 1);
      expect(sample?.wet).toBe(true);
      expect(sample?.level).toBeCloseTo(11);
      expect(sample?.properties.depth).toBeCloseTo(2);
      expect(sample?.properties.arrival).toBe(0);
    });

    it("keeps only the values that do not change over time where dry", () => {
      const sample = sampleTimeSeriesFlood(series, cell0, 2);
      expect(sample).toMatchObject({ wet: false, level: undefined });
      expect(Object.keys(sample?.properties ?? {}).sort()).toEqual([
        "arrival",
        "duration",
      ]);
      expect(
        sampleTimeSeriesFlood(series, cell0, "max")?.properties.speed,
      ).toBe(1);
      expect(sampleTimeSeriesFlood(series, cell1, 0)?.properties.arrival).toBe(
        1,
      );
    });

    it("interpolates the shoreline to the next frame", () => {
      // Cell 0 is dry in the last frame, so 1.75 interpolates it dry.
      expect(sampleTimeSeriesFlood(series, cell0, 1)?.wet).toBe(true);
      expect(sampleTimeSeriesFlood(series, cell0, 1.75)?.wet).toBe(false);
    });

    it("holds a rate over its interval", () => {
      // Cell 0 rises 1 m in the first hour.
      for (const frame of [0, 0.5, 0.9]) {
        expect(
          sampleTimeSeriesFlood(series, cell0, frame)?.properties.rate,
        ).toBeCloseTo(1);
      }
    });

    it("gives the maxima over the series", () => {
      const sample = sampleTimeSeriesFlood(series, cell1, "max");
      expect(sample?.wet).toBe(true);
      expect(sample?.level).toBeCloseTo(10.5);
      expect(sample?.properties.depth).toBeCloseTo(1);
    });

    it("gives nothing where the water never reaches", () => {
      expect(
        sampleTimeSeriesFlood(series, { lng: 0.0025, lat: 0.0005 }, 1),
      ).toBeUndefined();
      expect(
        sampleTimeSeriesFlood(series, { lng: 1, lat: 1 }, 1),
      ).toBeUndefined();
    });
  });

  describe("timeToFrame and frameToTime", () => {
    it("map times between unevenly spaced frames", () => {
      expect(timeToFrame(series, 1_800_000)).toBeCloseTo(0.5);
      expect(timeToFrame(series, new Date(7_200_000))).toBeCloseTo(1.5);
      expect(frameToTime(series, 1.5).getTime()).toBe(7_200_000);
    });

    it("clamp to the series", () => {
      expect(timeToFrame(series, -1)).toBe(0);
      expect(timeToFrame(series, 1e12)).toBe(2);
      expect(frameToTime(series, 5).getTime()).toBe(10_800_000);
    });
  });
});
