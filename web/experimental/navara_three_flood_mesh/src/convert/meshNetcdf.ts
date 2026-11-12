import { parseUtc } from "../utc";

import type { Input } from "./input";
import type { MeshSamplingOptions, MeshSeries, MeshStep } from "./mesh";
import {
  numberAttribute,
  unpack,
  type Netcdf,
  type NetcdfVariable,
} from "./netcdf";
import { PropertyCollector, type PropertiesOption } from "./properties";

export type MeshNetcdfOptions = MeshSamplingOptions & {
  /**
   * A netCDF file of a mesh and its values over time: following the UGRID
   * conventions, or triangles in `x`, `y` and `volumes`, as in a `.sww`.
   * See `withNetcdf` for the formats read.
   */
  input: Input;
  /** The UGRID mesh topology variable, when the file holds more than one. */
  mesh?: string;
  /**
   * Variable of the water level, or of the depth, which adds up to it with
   * the ground height; `stage` and `elevation` by default with `volumes`.
   * The level is on the nodes or the faces, by its `location`, and the
   * ground on the same. With `ground`, the ground height is stored as the
   * `ground` property; see `MeshCsvOptions.level`.
   */
  level?: string;
  ground?: string;
  depth?: string;
  /**
   * What the times count from when their `units` name no date; the file's
   * `starttime` attribute, if any, is added to them.
   */
  epoch?: Date;
  /**
   * Properties stored with each node (or face): variables on them over time
   * (or not) to take, or a callback given every such variable's value at a
   * wet node, by name.
   */
  properties?: PropertiesOption;
};

const SECONDS_PER_UNIT: Record<string, number> = {
  second: 1,
  sec: 1,
  s: 1,
  minute: 60,
  min: 60,
  hour: 3600,
  hr: 3600,
  h: 3600,
  day: 86400,
  d: 86400,
};

const stringAttribute = (variable: NetcdfVariable | Netcdf, key: string) => {
  const value = variable.attributes[key];
  return typeof value === "string" ? value.trim() : undefined;
};

/**
 * Seconds since the Unix epoch of `time`'s values: CF units of
 * `<unit> since <date>`, or seconds since `epoch`.
 */
const secondsOf = (
  file: Netcdf,
  time: NetcdfVariable,
  epoch: Date | undefined,
  start: number,
) => {
  const units = stringAttribute(time, "units") ?? "seconds";
  const match = /^(\w+?)s?(?:\s+since\s+(.+))?$/i.exec(units);
  const unit = match && SECONDS_PER_UNIT[match[1].toLowerCase()];
  if (!match || !unit) {
    throw new Error(`${file.name}: time units ${units} are not understood.`);
  }
  let origin: number;
  if (match[2]) {
    origin = parseUtc(match[2].replace(/\s*(UTC|GMT)$/i, "Z")) / 1000;
    if (Number.isNaN(origin)) {
      throw new Error(`${file.name}: time units ${units} name no date.`);
    }
  } else {
    if (!epoch) throw new Error(`${file.name}: the times need an epoch.`);
    origin = epoch.getTime() / 1000 + start;
  }
  const values = unpack(time, time.read());
  const times = values.map((v) => origin + v * unit);
  for (let k = 1; k < times.length; k++) {
    if (!(times[k] > times[k - 1])) {
      throw new Error(`${file.name}: the times do not increase.`);
    }
  }
  return times;
};

/** The variable `key` of `file`, or an error naming it. */
const variableOf = (file: Netcdf, key: string) => {
  const variable = file.variables.get(key);
  if (!variable) throw new Error(`${file.name} has no variable ${key}.`);
  return variable;
};

type Topology = {
  x: Float64Array;
  y: Float64Array;
  faces: { starts: Int32Array; nodes: Int32Array };
  /** Whether a variable is on the nodes or the faces, or neither. */
  locationOf: (key: string) => "nodes" | "faces" | undefined;
  defaults: { level?: string; ground?: string };
};

/** Faces as rings of node indices from a connectivity table. */
const ringsOf = (
  table: ArrayLike<number>,
  width: number,
  start: number,
  fill: number | undefined,
) => {
  const starts = [0];
  const nodes: number[] = [];
  for (let f = 0; f * width < table.length; f++) {
    for (let j = 0; j < width; j++) {
      const n = table[f * width + j];
      if (n === fill || n < start) break;
      nodes.push(n - start);
    }
    starts.push(nodes.length);
  }
  return { starts: Int32Array.from(starts), nodes: Int32Array.from(nodes) };
};

/** The mesh of a file following the UGRID conventions, if it does. */
const ugridOf = (file: Netcdf, mesh?: string): Topology | undefined => {
  const topologies = [...file.variables].filter(
    ([key, v]) =>
      stringAttribute(v, "cf_role") === "mesh_topology" &&
      numberAttribute(v.attributes, "topology_dimension") === 2 &&
      (mesh === undefined || key === mesh),
  );
  if (mesh !== undefined && !topologies.length) {
    throw new Error(`${file.name} has no 2-D mesh topology ${mesh}.`);
  }
  if (!topologies.length) return undefined;
  if (topologies.length > 1) {
    throw new Error(
      `${file.name} has ${topologies.length} 2-D meshes; name one with mesh.`,
    );
  }
  const [name, topology] = topologies[0];
  const names = (key: string) => {
    const value = stringAttribute(topology, key);
    if (!value) throw new Error(`${file.name}: ${name} has no ${key}.`);
    return value.split(/\s+/);
  };
  // The coordinates in the order given, unless their names say otherwise.
  let [xKey, yKey] = names("node_coordinates");
  const isY = (key: string) => {
    const v = variableOf(file, key);
    const standard = stringAttribute(v, "standard_name");
    return (
      standard === "latitude" ||
      standard === "projection_y_coordinate" ||
      stringAttribute(v, "units") === "degrees_north"
    );
  };
  if (isY(xKey)) [xKey, yKey] = [yKey, xKey];
  const [connectivityKey] = names("face_node_connectivity");
  const connectivity = variableOf(file, connectivityKey);
  const x = unpack(variableOf(file, xKey), variableOf(file, xKey).read());
  const y = unpack(variableOf(file, yKey), variableOf(file, yKey).read());
  const faces = ringsOf(
    connectivity.read(),
    connectivity.shape[1],
    numberAttribute(connectivity.attributes, "start_index") ?? 0,
    numberAttribute(connectivity.attributes, "_FillValue"),
  );
  return {
    x,
    y,
    faces,
    locationOf: (key) => {
      const v = variableOf(file, key);
      if (stringAttribute(v, "mesh") !== name) return undefined;
      const location = stringAttribute(v, "location");
      return location === "node"
        ? "nodes"
        : location === "face"
          ? "faces"
          : undefined;
    },
    defaults: {},
  };
};

/** The triangles `volumes` over the nodes `x` and `y`, if the file has them. */
const swwOf = (file: Netcdf): Topology | undefined => {
  const { variables } = file;
  const volumes = variables.get("volumes");
  if (!volumes || !variables.has("x") || !variables.has("y")) return;
  const corner = (key: string) => numberAttribute(file.attributes, key) ?? 0;
  const x = unpack(variableOf(file, "x"), variableOf(file, "x").read());
  const y = unpack(variableOf(file, "y"), variableOf(file, "y").read());
  for (let n = 0; n < x.length; n++) {
    x[n] += corner("xllcorner");
    y[n] += corner("yllcorner");
  }
  const points = x.length;
  return {
    x,
    y,
    faces: ringsOf(volumes.read(), volumes.shape[1], 0, undefined),
    locationOf: (key) => {
      const { shape } = variableOf(file, key);
      return shape[shape.length - 1] === points ? "nodes" : undefined;
    },
    defaults: { level: "stage", ground: "elevation" },
  };
};

/**
 * The mesh and the values over time of a netCDF `file`, read a step at a
 * time while it stays open.
 */
export const meshSeriesOfNetcdf = (
  file: Netcdf,
  options: MeshNetcdfOptions,
): MeshSeries => {
  const { minDepth = 0.01, epoch, properties } = options;
  const topology = ugridOf(file, options.mesh) ?? swwOf(file);
  if (!topology) {
    throw new Error(
      `${file.name} holds neither a UGRID mesh topology nor the variables x, y and volumes.`,
    );
  }
  const depth = options.depth;
  const level = depth ? undefined : (options.level ?? topology.defaults.level);
  const ground = options.ground ?? topology.defaults.ground;
  if (!level && !depth) throw new Error("Give either level or depth.");
  if (depth && !ground) throw new Error("A depth needs the ground.");
  const valueKey = (level ?? depth) as string;
  const valuesOn = topology.locationOf(valueKey);
  if (!valuesOn) {
    throw new Error(`${file.name}: ${valueKey} is on neither nodes nor faces.`);
  }
  const elementCount =
    valuesOn === "faces" ? topology.faces.starts.length - 1 : topology.x.length;

  /** Whether `key` is on the elements over time, or not over time. */
  const shapeOf = (key: string) => {
    const { shape } = variableOf(file, key);
    if (topology.locationOf(key) !== valuesOn) return undefined;
    if (shape.length === 1 && shape[0] === elementCount) return "static";
    if (shape.length === 2 && shape[1] === elementCount) return "series";
    return undefined;
  };
  const unpacked = (key: string, k?: number) => {
    const variable = variableOf(file, key);
    return unpack(variable, variable.read(k));
  };
  if (shapeOf(valueKey) !== "series") {
    throw new Error(`${file.name}: ${valueKey} does not change over time.`);
  }
  if (ground !== undefined && shapeOf(ground) !== "static") {
    throw new Error(
      `${file.name}: the ground ${ground} must be on the ${valuesOn} and not change over time.`,
    );
  }
  const groundValues = ground === undefined ? undefined : unpacked(ground);

  const valueSeries = variableOf(file, valueKey);
  const stepCount = valueSeries.shape[0];
  const timeKey =
    [...file.variables].find(
      ([key, v]) =>
        v.shape.length === 1 &&
        v.shape[0] === stepCount &&
        (key === "time" || stringAttribute(v, "standard_name") === "time"),
    )?.[0] ?? "time";
  const times = secondsOf(
    file,
    variableOf(file, timeKey),
    epoch,
    numberAttribute(file.attributes, "starttime") ?? 0,
  );

  const collector = properties && new PropertyCollector(properties);
  // The variables a property may come from: those named, or all on the
  // elements for a callback.
  const sources = [...file.variables.keys()].flatMap((key) => {
    if (Array.isArray(properties) && !properties.includes(key)) return [];
    const shape = shapeOf(key);
    return shape
      ? [{ key, shape, values: shape === "static" ? unpacked(key) : undefined }]
      : [];
  });
  if (Array.isArray(properties)) {
    const missing = properties.filter(
      (key) => !sources.some((s) => s.key === key),
    );
    if (missing.length) {
      throw new Error(
        `${file.name} has no ${missing.join(", ")} on the ${valuesOn}.`,
      );
    }
  }

  return {
    source: file.name,
    x: topology.x,
    y: topology.y,
    faces: topology.faces,
    valuesOn,
    ground: groundValues,
    times,
    step: (k): MeshStep => {
      const value = unpacked(valueKey, k);
      const index: number[] = [];
      const levels: number[] = [];
      for (let e = 0; e < elementCount; e++) {
        const g = groundValues?.[e] ?? NaN;
        const levelValue = depth
          ? value[e] >= minDepth
            ? g + value[e]
            : NaN
          : value[e];
        // Without the ground, a level is wet wherever it is given.
        if (!Number.isFinite(levelValue) || levelValue - g < minDepth) continue;
        index.push(e);
        levels.push(levelValue);
      }
      const stepProperties: Record<string, number[]> = {};
      if (collector) {
        const arrays = sources.map(({ key, values }) => ({
          key,
          values: values ?? unpacked(key, k),
        }));
        index.forEach((e, row) => {
          const record: Record<string, number> = {};
          for (const { key, values } of arrays) record[key] = values[e];
          const collected = collector.collect(record);
          // A property first seen on a later node is missing on the earlier.
          for (const name of collector.names) {
            (stepProperties[name] ??= new Array<number>(row).fill(NaN)).push(
              collected[name] ?? NaN,
            );
          }
        });
      }
      return { index, levels, properties: stepProperties };
    },
    properties: collector,
  };
};
