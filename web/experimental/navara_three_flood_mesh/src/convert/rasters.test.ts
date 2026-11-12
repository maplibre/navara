// @vitest-environment node
// h5wasm reads the files it writes from its own file system, which jsdom's
// typed arrays of another realm do not reach.
import * as h5wasm from "h5wasm";
import { describe, expect, it } from "vitest";

import { sampleTimeSeriesFlood } from "../sample";
import { loadTimeSeriesFlood } from "../series";

import { Ellipsoid } from "./datum";
import { PlaneRectangular } from "./projection";
import { readRaster } from "./raster";
import { convertRasters } from "./rasters";

// 40 × 30 nodes 2 m apart in plane rectangular zone IX, near its origin.
const WIDTH = 40;
const HEIGHT = 30;
const STEP = 2;

/**
 * A netCDF-4 grid, `z(y, x)` with a NaN fill value, its
 * first node at `x0`, `y0` and the others `step` apart, the coordinates in
 * `Coordinates`.
 */
const grid = async (
  name: string,
  value: (c: number, r: number) => number,
  { x0, y0, step } = { x0: 1000, y0: 2000, step: STEP },
  Coordinates: Float64ArrayConstructor | Float32ArrayConstructor = Float64Array,
) => {
  const { FS } = await h5wasm.ready;
  const path = `/${name}`;
  const file = new h5wasm.File(path, "w");
  file.create_dataset({
    name: "x",
    data: new Coordinates(
      Array.from({ length: WIDTH }, (_, c) => x0 + c * step),
    ),
  });
  file.create_dataset({
    name: "y",
    data: new Coordinates(
      Array.from({ length: HEIGHT }, (_, r) => y0 + r * step),
    ),
  });
  const z = Float32Array.from({ length: WIDTH * HEIGHT }, (_, i) =>
    value(i % WIDTH, Math.floor(i / WIDTH)),
  );
  file
    .create_dataset({ name: "z", data: z, shape: [HEIGHT, WIDTH] })
    .create_attribute("_FillValue", new Float32Array([NaN]));
  file.close();
  const bytes = FS.readFile(path) as Uint8Array;
  FS.unlink(path);
  return { name, read: () => bytes.slice() };
};

/**
 * A classic netCDF (CDF-1) grid in the legacy layout: 3 × 2 nodes over
 * x 10-20 and y 20-30, `z` given from the northern row.
 */
const legacyGrid = (z: number[]) => {
  /** `array` as big-endian bytes. */
  const bigEndian = (array: Float64Array | Float32Array | Int32Array) => {
    const bytes = new Uint8Array(array.buffer);
    const size = array.BYTES_PER_ELEMENT;
    return Array.from(
      bytes,
      (_, i) => bytes[i - (i % size) + size - 1 - (i % size)],
    );
  };
  const variables: [string, number, number, number[]][] = [
    ["x_range", 0, 6, bigEndian(new Float64Array([10, 20]))],
    ["y_range", 0, 6, bigEndian(new Float64Array([20, 30]))],
    ["dimension", 0, 4, bigEndian(new Int32Array([3, 2]))],
    ["z", 1, 5, bigEndian(new Float32Array(z))],
  ];
  /** The header, with the data starting `start` bytes into the file. */
  const header = (start: number) => {
    const out: number[] = [67, 68, 70, 1];
    const int = (...values: number[]) =>
      out.push(...bigEndian(new Int32Array(values)));
    const name = (text: string) => {
      int(text.length);
      out.push(
        ...new TextEncoder().encode(
          text.padEnd(Math.ceil(text.length / 4) * 4, "\0"),
        ),
      );
    };
    // No records; the dimensions `side` and `xysize`; no global attribute.
    int(0, 10, 2);
    name("side");
    int(2);
    name("xysize");
    int(z.length, 0, 0, 11, variables.length);
    let begin = start;
    for (const [key, dimension, type, data] of variables) {
      name(key);
      int(1, dimension);
      if (key === "z") {
        int(12, 1);
        name("node_offset");
        int(4, 1, 0);
      } else int(0, 0);
      int(type, data.length, begin);
      begin += data.length;
    }
    return out;
  };
  const bytes = Uint8Array.from([
    ...header(header(0).length),
    ...variables.flatMap(([, , , data]) => data),
  ]);
  return { name: "legacy.grd", read: () => bytes };
};

const projection = new PlaneRectangular(9);

describe("readRaster", () => {
  it("reads the grid, its coordinates and missing values", async () => {
    const raster = await readRaster(
      await grid("a.nc", (c, r) => (c === 0 ? NaN : c + 100 * r)),
    );
    expect(raster).toMatchObject({
      width: WIDTH,
      height: HEIGHT,
      x0: 1000,
      y0: 2000,
      dx: STEP,
      dy: STEP,
    });
    expect(raster.values[0]).toBeNaN();
    expect(raster.values[WIDTH + 3]).toBe(103);
  });

  it("reads float32 degrees a fine step apart as evenly spaced", async () => {
    const step = 1 / 3200;
    const raster = await readRaster(
      await grid("f.nc", () => 1, { x0: 139.5, y0: 35.5, step }, Float32Array),
    );
    expect(raster.dx).toBeCloseTo(step, 6);
    expect(raster.dy).toBeCloseTo(step, 6);
  });

  it("refuses coordinates that are not evenly spaced", async () => {
    const { FS } = await h5wasm.ready;
    const file = new h5wasm.File("/u.nc", "w");
    file.create_dataset({ name: "x", data: new Float64Array([0, 1, 3]) });
    file.create_dataset({ name: "y", data: new Float64Array([0, 1]) });
    file.create_dataset({
      name: "z",
      data: new Float32Array(6),
      shape: [2, 3],
    });
    file.close();
    const bytes = FS.readFile("/u.nc") as Uint8Array;
    FS.unlink("/u.nc");
    await expect(
      readRaster({ name: "u.nc", read: () => bytes.slice() }),
    ).rejects.toThrow(/not evenly spaced/);
  });

  it("reads the legacy layout of classic netCDF, rows from the north", async () => {
    const raster = await readRaster(legacyGrid([1, 2, 3, 4, 5, 6]));
    expect(raster).toMatchObject({ width: 3, height: 2, x0: 10, y0: 20 });
    expect(raster.dx).toBeCloseTo(5);
    expect(raster.dy).toBeCloseTo(10);
    // The first row read is the northern, stored last.
    expect(Array.from(raster.values)).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it("refuses a file that is not netCDF", async () => {
    await expect(
      readRaster({ name: "a.txt", read: () => "ncols 3" }),
    ).rejects.toThrow(/not a netCDF file/);
  });
});

describe("convertRasters from netCDF", () => {
  it("averages the source cells, wet where half of them are", async () => {
    const store = new Map<string, Uint8Array>();
    // The western half is wet, at a level rising by 1 m per column.
    const level = (step: number) =>
      grid(`SD.${step}.grd`, (c) => (c < WIDTH / 2 ? 10 + c + step : NaN));
    const info = await convertRasters({
      inputs: [await level(0), await level(1)],
      series: {
        vx: [
          await grid("SD.0-vx.grd", () => 3),
          await grid("SD.1-vx.grd", () => 3),
        ],
        vy: [
          await grid("SD.0-vy.grd", () => 4),
          await grid("SD.1-vy.grd", () => 4),
        ],
      },
      ground: await grid("ground.grd", () => -5),
      groundScale: -1,
      output: store,
      projection,
      resolution: 10,
      timePattern: /SD\.(\d+)/,
      epoch: new Date(0),
      datum: new Ellipsoid(),
      properties: ({ vx, vy }) => ({
        speed: Math.hypot(Number(vx), Number(vy)),
      }),
    });
    expect(info.stepCount).toBe(2);
    expect(info.sourceWidth).toBe(WIDTH);

    const series = await loadTimeSeriesFlood({ store });
    const at = (c: number, r: number, frame: number) => {
      const [lng, lat] = projection.toGeographic(
        1000 + c * STEP,
        2000 + r * STEP,
      );
      return sampleTimeSeriesFlood(series, { lng, lat }, frame);
    };
    // A cell 10 m across averages the five columns within it, one of which
    // is where it was sampled.
    const level0 = at(10, 15, 0)?.level ?? NaN;
    expect(Math.abs(level0 - 20)).toBeLessThanOrEqual(2);
    expect(at(10, 15, 1)?.level).toBeCloseTo(level0 + 1, 3);
    expect(at(10, 15, 0)?.properties.speed).toBeCloseTo(5, 1);
    expect(at(10, 15, 0)?.properties.depth).toBeCloseTo(level0 - 5, 3);
    expect(at(32, 15, 0)).toBeUndefined();
  });

  it("leaves building cells out, and offsets the heights", async () => {
    const store = new Map<string, Uint8Array>();
    // Two columns of every three are buildings, kept dry.
    const building = (c: number) => c % 3 !== 0;
    await convertRasters({
      inputs: [await grid("SD.0.grd", (c) => (building(c) ? NaN : 3))],
      buildings: await grid("bldg.grd", (c) => (building(c) ? -8 : 0)),
      ground: await grid("ground.grd", (c) => (building(c) ? 9 : 1)),
      datumOffset: 0.5,
      output: store,
      projection,
      resolution: 10,
      timePattern: /SD\.(\d+)/,
      epoch: new Date(0),
      datum: new Ellipsoid(),
    });
    const series = await loadTimeSeriesFlood({ store });
    const [lng, lat] = projection.toGeographic(
      1000 + 20 * STEP,
      2000 + 15 * STEP,
    );
    const sample = sampleTimeSeriesFlood(series, { lng, lat }, 0);
    expect(sample?.level).toBeCloseTo(3.5, 3);
    // The ground of the open cells only.
    expect(sample?.properties.depth).toBeCloseTo(2, 3);
  });

  it("takes the nearest source cell at a finer resolution", async () => {
    const store = new Map<string, Uint8Array>();
    await convertRasters({
      inputs: [await grid("SD.0.grd", (c) => 10 + c)],
      output: store,
      projection,
      resolution: 0.5,
      timePattern: /SD\.(\d+)/,
      epoch: new Date(0),
      datum: new Ellipsoid(),
    });
    const series = await loadTimeSeriesFlood({ store });
    // Between the nodes of columns 10 and 11, nearer 11.
    for (const [x, level] of [
      [1000 + 10.2 * STEP, 20],
      [1000 + 10.8 * STEP, 21],
    ]) {
      const [lng, lat] = projection.toGeographic(x, 2000 + 15 * STEP);
      expect(sampleTimeSeriesFlood(series, { lng, lat }, 0)?.level).toBeCloseTo(
        level,
        3,
      );
    }
  });

  it("writes rasters in degrees cell for cell without a resolution", async () => {
    const store = new Map<string, Uint8Array>();
    const placement = { x0: 139.00005, y0: 35.00005, step: 0.0001 };
    const info = await convertRasters({
      inputs: [await grid("SD.0.grd", (c, r) => (c < 10 ? r : NaN), placement)],
      output: store,
      timePattern: /SD\.(\d+)/,
      epoch: new Date(0),
      datum: new Ellipsoid(),
    });
    expect(info.grid.lngStep).toBeCloseTo(0.0001, 9);
    expect(info.wetCells).toBe(10 * HEIGHT);
    const series = await loadTimeSeriesFlood({ store });
    expect(
      sampleTimeSeriesFlood(series, { lng: 139.00055, lat: 35.00125 }, 0)
        ?.level,
    ).toBeCloseTo(12, 3);
    expect(
      sampleTimeSeriesFlood(series, { lng: 139.00105, lat: 35.00125 }, 0),
    ).toBeUndefined();
  });
});

describe("convertRasters with terrain", () => {
  const placement = { x0: 139.00005, y0: 35.00005, step: 0.0001 };

  it("stores the sampled terrain as the ground, from which the depth derives", async () => {
    const store = new Map<string, Uint8Array>();
    const sampled: { lng: number; lat: number }[] = [];
    await convertRasters({
      inputs: [
        await grid("SD.0.grd", (c, r) => (c < 10 ? 10 + r : NaN), placement),
        await grid("SD.1.grd", (c, r) => (c < 20 ? 10 + r : NaN), placement),
      ],
      output: store,
      timePattern: /SD\.(\d+)/,
      epoch: new Date(0),
      datum: new Ellipsoid(),
      terrain: (positions) => {
        sampled.push(...positions);
        return Promise.resolve(
          positions.map(({ lng }) => ({ height: lng - 132 })),
        );
      },
    });
    // Once, at the center of each cell ever wet.
    expect(sampled).toHaveLength(20 * HEIGHT);
    const series = await loadTimeSeriesFlood({ store });
    const sample = sampleTimeSeriesFlood(
      series,
      { lng: 139.00055, lat: 35.00125 },
      1,
    );
    expect(sample?.level).toBeCloseTo(22, 3);
    expect(sample?.properties.depth).toBeCloseTo(22 - 7.00055, 2);
  });

  it("refuses terrain for a series with the ground", async () => {
    await expect(
      convertRasters({
        inputs: [await grid("SD.0.grd", () => 3, placement)],
        ground: await grid("ground.grd", () => 1, placement),
        output: new Map(),
        timePattern: /SD\.(\d+)/,
        epoch: new Date(0),
        datum: new Ellipsoid(),
        terrain: (positions) =>
          Promise.resolve(positions.map(() => ({ height: 0 }))),
      }),
    ).rejects.toThrow("leave out terrain");
  });
});
