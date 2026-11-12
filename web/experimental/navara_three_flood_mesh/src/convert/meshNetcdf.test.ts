// @vitest-environment node
// h5wasm reads the files it writes from its own file system, which jsdom's
// typed arrays of another realm do not reach.
import * as h5wasm from "h5wasm";
import { describe, expect, it } from "vitest";

import { sampleTimeSeriesFlood } from "../sample";
import { loadTimeSeriesFlood } from "../series";

import { Ellipsoid } from "./datum";
import { convertMesh } from "./mesh";
import { withNetcdf } from "./netcdf";

type ClassicVariable = {
  name: string;
  dimensions: string[];
  /** 4 int, 5 float, 6 double. */
  type: 4 | 5 | 6;
  data: number[];
  attributes?: Record<string, string | number[]>;
};

const SIZES = { 4: 4, 5: 4, 6: 8 };

/**
 * A classic netCDF file (CDF-1). A dimension of length 0 is the record
 * dimension, of `records` records.
 */
const classic = (
  dimensions: [string, number][],
  records: number,
  variables: ClassicVariable[],
  attributes: Record<string, string | number[]> = {},
) => {
  const lengthOf = (name: string) =>
    dimensions.find(([d]) => d === name)?.[1] as number;
  const isRecord = (v: ClassicVariable) => lengthOf(v.dimensions[0]) === 0;
  const sliceBytes = (v: ClassicVariable) =>
    v.dimensions
      .filter((d) => lengthOf(d) !== 0)
      .reduce((a, d) => a * lengthOf(d), 1) * SIZES[v.type];
  const padded = (n: number) => Math.ceil(n / 4) * 4;
  const recordVariables = variables.filter(isRecord);

  const build = (begins: number[]) => {
    const out: number[] = [];
    const int = (...values: number[]) => {
      for (const v of values)
        out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    };
    const text = (value: string) => {
      int(value.length);
      out.push(
        ...new TextEncoder().encode(value.padEnd(padded(value.length), "\0")),
      );
    };
    const attributeList = (list: Record<string, string | number[]>) => {
      const entries = Object.entries(list);
      if (!entries.length) return int(0, 0);
      int(12, entries.length);
      for (const [key, value] of entries) {
        text(key);
        if (typeof value === "string") {
          int(2);
          text(value);
        } else {
          int(6, value.length);
          out.push(...bigEndian(new Float64Array(value)));
        }
      }
    };
    out.push(67, 68, 70, 1);
    int(records, 10, dimensions.length);
    for (const [name, length] of dimensions) {
      text(name);
      int(length);
    }
    attributeList(attributes);
    int(11, variables.length);
    variables.forEach((v, i) => {
      text(v.name);
      int(
        v.dimensions.length,
        ...v.dimensions.map((d) => dimensions.findIndex(([n]) => n === d)),
      );
      attributeList(v.attributes ?? {});
      int(
        v.type,
        padded(isRecord(v) ? sliceBytes(v) : sliceBytes(v)),
        begins[i],
      );
    });
    return out;
  };
  const bytesOf = (v: ClassicVariable, values: number[]) =>
    bigEndian(
      v.type === 4
        ? new Int32Array(values)
        : v.type === 5
          ? new Float32Array(values)
          : new Float64Array(values),
    );

  // The header's length does not depend on where the data begins.
  const headerLength = build(variables.map(() => 0)).length;
  const begins: number[] = [];
  let at = headerLength;
  for (const v of variables.filter((v) => !isRecord(v))) {
    begins[variables.indexOf(v)] = at;
    at += padded(sliceBytes(v));
  }
  for (const v of recordVariables) {
    begins[variables.indexOf(v)] = at;
    at += padded(sliceBytes(v));
  }
  const out = build(begins);
  for (const v of variables.filter((v) => !isRecord(v))) {
    const data = bytesOf(v, v.data);
    out.push(
      ...data,
      ...new Array<number>(padded(data.length) - data.length).fill(0),
    );
  }
  for (let r = 0; r < records; r++) {
    for (const v of recordVariables) {
      const count = sliceBytes(v) / SIZES[v.type];
      const data = bytesOf(v, v.data.slice(r * count, (r + 1) * count));
      out.push(
        ...data,
        ...new Array<number>(padded(data.length) - data.length).fill(0),
      );
    }
  }
  return Uint8Array.from(out);
};

/** `array` as big-endian bytes. */
const bigEndian = (array: Float64Array | Float32Array | Int32Array) => {
  const bytes = new Uint8Array(array.buffer);
  const size = array.BYTES_PER_ELEMENT;
  return Array.from(
    bytes,
    (_, i) => bytes[i - (i % size) + size - 1 - (i % size)],
  );
};

/**
 * A netCDF of triangles in `x`, `y` and `volumes` (a `.sww`) of a 0.002°
 * square as four nodes and two triangles, the positions in degrees from its
 * lower left corner, over two steps.
 */
const sww = () =>
  classic(
    [
      ["number_of_volumes", 2],
      ["number_of_vertices", 3],
      ["number_of_points", 4],
      ["number_of_timesteps", 0],
    ],
    2,
    [
      {
        name: "x",
        dimensions: ["number_of_points"],
        type: 5,
        data: [0, 0.002, 0.002, 0],
      },
      {
        name: "y",
        dimensions: ["number_of_points"],
        type: 5,
        data: [0, 0, 0.002, 0.002],
      },
      {
        name: "volumes",
        dimensions: ["number_of_volumes", "number_of_vertices"],
        type: 4,
        data: [0, 1, 2, 0, 2, 3],
      },
      {
        name: "elevation",
        dimensions: ["number_of_points"],
        type: 5,
        data: [0, 0, 0, 0],
      },
      {
        name: "time",
        dimensions: ["number_of_timesteps"],
        type: 6,
        data: [0, 60],
      },
      // At 60 s, the east nodes are dry.
      {
        name: "stage",
        dimensions: ["number_of_timesteps", "number_of_points"],
        type: 5,
        data: [10, 12, 13, 11, 1, 0, 0, 1],
      },
      {
        name: "xmomentum",
        dimensions: ["number_of_timesteps", "number_of_points"],
        type: 5,
        data: [20, 24, 26, 22, 2, 0, 0, 2],
      },
    ],
    { starttime: [30], xllcorner: [139], yllcorner: [35] },
  );

const levelAt = async (
  store: Map<string, Uint8Array>,
  lng: number,
  lat: number,
  frame: number,
) =>
  sampleTimeSeriesFlood(
    await loadTimeSeriesFlood({ store }),
    { lng, lat },
    frame,
  );

const options = {
  resolution: 10,
  datum: new Ellipsoid(),
  epoch: new Date(0),
};

describe("withNetcdf", () => {
  it("reads the record variables of classic netCDF a record at a time", async () => {
    const bytes = sww();
    await withNetcdf({ name: "a.sww", read: () => bytes }, (file) => {
      const stage = file.variables.get("stage");
      expect(stage?.shape).toEqual([2, 4]);
      expect(Array.from(stage?.read(1) ?? [])).toEqual([1, 0, 0, 1]);
      expect(Array.from(stage?.read() ?? [])).toEqual([
        10, 12, 13, 11, 1, 0, 0, 1,
      ]);
      expect(Array.from(file.variables.get("time")?.read() ?? [])).toEqual([
        0, 60,
      ]);
      expect(file.attributes.starttime).toEqual([30]);
    });
  });
});

describe("convertMesh from netCDF", () => {
  it("reads triangles in volumes: stage over elevation, with properties", async () => {
    const store = new Map<string, Uint8Array>();
    const bytes = sww();
    const info = await convertMesh({
      ...options,
      input: { name: "a.sww", read: () => bytes },
      output: store,
      minDepth: 0.1,
      properties: ({ stage, elevation, xmomentum }) => ({
        speed:
          (xmomentum as number) / ((stage as number) - (elevation as number)),
      }),
    });
    expect(info).toMatchObject({
      nodeCount: 4,
      triangleCount: 2,
      stepCount: 2,
    });
    const series = await loadTimeSeriesFlood({ store });
    // The times count from the epoch and the file's start time.
    expect(series.times.map((t) => t.getTime() / 1000)).toEqual([30, 90]);
    const first = await levelAt(store, 139.001, 35.001, 0);
    expect(first?.level).toBeCloseTo(11.5, 1);
    expect(first?.properties.speed).toBeCloseTo(2, 1);
    // The water thins out towards the dry east nodes, shallower than 0.1 m
    // within about 18 m of them.
    expect((await levelAt(store, 139.0005, 35.001, 1))?.level).toBeCloseTo(
      0.75,
      1,
    );
    expect((await levelAt(store, 139.0019, 35.001, 1))?.wet).toBeFalsy();
  });

  it("reads UGRID netCDF-4 with values on the faces", async () => {
    const { FS } = await h5wasm.ready;
    const path = "/ugrid.nc";
    const file = new h5wasm.File(path, "w");
    file
      .create_dataset({ name: "mesh2d", data: new Int32Array([0]) })
      .create_attribute("cf_role", "mesh_topology");
    const mesh = file.get("mesh2d") as h5wasm.Dataset;
    mesh.create_attribute("topology_dimension", new Int32Array([2]));
    // The coordinates listed y first, as their names tell.
    mesh.create_attribute("node_coordinates", "node_lat node_lon");
    mesh.create_attribute("face_node_connectivity", "face_nodes");
    file
      .create_dataset({
        name: "node_lon",
        data: new Float64Array([139, 139.002, 139.002, 139, 139.004]),
      })
      .create_attribute("standard_name", "longitude");
    file
      .create_dataset({
        name: "node_lat",
        data: new Float64Array([35, 35, 35.002, 35.002, 35]),
      })
      .create_attribute("standard_name", "latitude");
    // A square and a triangle, 1-based, the triangle's last node a fill.
    const faces = file.create_dataset({
      name: "face_nodes",
      data: new Int32Array([1, 2, 3, 4, 2, 5, 3, -999]),
      shape: [2, 4],
    });
    faces.create_attribute("start_index", new Int32Array([1]));
    faces.create_attribute("_FillValue", new Int32Array([-999]));
    file
      .create_dataset({ name: "time", data: new Float64Array([0, 10]) })
      .create_attribute("units", "minutes since 2020-01-01 00:00:00");
    const onFaces = (name: string, data: Float32Array, shape: number[]) => {
      const dataset = file.create_dataset({ name, data, shape });
      dataset.create_attribute("mesh", "mesh2d");
      dataset.create_attribute("location", "face");
    };
    onFaces("s1", new Float32Array([5, 7, 6, 0]), [2, 2]);
    onFaces("bl", new Float32Array([0, 0]), [2]);
    file.close();
    const bytes = FS.readFile(path) as Uint8Array;
    FS.unlink(path);

    const store = new Map<string, Uint8Array>();
    const info = await convertMesh({
      ...options,
      input: { name: "ugrid.nc", read: () => bytes.slice() },
      output: store,
      level: "s1",
      ground: "bl",
    });
    // The square splits into two triangles.
    expect(info).toMatchObject({
      nodeCount: 5,
      triangleCount: 3,
      stepCount: 2,
    });
    const series = await loadTimeSeriesFlood({ store });
    expect(series.times.map((t) => t.toISOString())).toEqual([
      "2020-01-01T00:00:00.000Z",
      "2020-01-01T00:10:00.000Z",
    ]);
    expect((await levelAt(store, 139.001, 35.001, 0))?.level).toBeCloseTo(5, 1);
    expect((await levelAt(store, 139.003, 35.0005, 0))?.level).toBeCloseTo(
      7,
      1,
    );
    // The triangle is dry in the second step.
    expect((await levelAt(store, 139.003, 35.0005, 1))?.wet).toBeFalsy();
  });

  it("asks which variable is the level when no default applies", async () => {
    const bytes = sww();
    await expect(
      convertMesh({
        ...options,
        input: { name: "a.sww", read: () => bytes },
        output: new Map(),
        level: "momentum",
      }),
    ).rejects.toThrow(/no variable momentum/);
  });
});
