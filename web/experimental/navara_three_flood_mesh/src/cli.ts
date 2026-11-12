#!/usr/bin/env node
/**
 * `navara-flood-zarr <config>`: converts a flood simulation into the Zarr
 * group `loadTimeSeriesFlood` reads, as a configuration file says (see
 * `ConvertConfig`). The converters themselves run anywhere; this wraps them
 * over files.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { glob, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import FileSystemStore from "@zarrita/storage/fs";

import {
  convertMesh,
  convertPolygons,
  convertRasters,
  Egm2008Geoid,
  Ellipsoid,
  VerticalDatum,
  type Projection,
  type ConvertConfig,
  type FloodTolerance,
  type FloodZarrInfo,
  type Input,
  type MeshConfig,
  type TimeOptions,
  type PolygonsConfig,
  type PropertiesOption,
  type PropertyConfig,
  type RastersConfig,
  type RastersInfo,
} from "./convert";
import { describeGrid } from "./convert/grid";
import { formatOf } from "./convert/input";
import { planeRectangularOf } from "./convert/projection";
import { parseDuration } from "./convert/time";
import { parseUtc } from "./utc";

const USAGE = `Usage: navara-flood-zarr <config.json | config.mjs>

The configuration holds the options of a converter by the shape of the data
("type"): convertRasters ("rasters", a regular grid, from CSV or netCDF),
convertMesh ("mesh", from CSV or netCDF) or convertPolygons ("polygons",
from CZML). The extension of the inputs gives their "format" unless it is
set. Paths are relative to the file; a module default-exports the same
object and may hold a properties callback and a VerticalDatum. For example:

{
  "type": "rasters",
  "inputs": ["csv/flood_*m.csv"],
  "output": "flood.zarr",
  "corners": [["west", "south"], ["east", "north"]],
  "ground": "ground",
  "depth": "depth",
  "timePattern": "_(\\\\d+)m\\\\.csv$",
  "timeUnit": "minutes",
  "epoch": "2026-01-01T00:00:00Z",
  "interval": "30m",
  "maxLevelError": 0.05,
  "properties": { "speed": { "source": "speed", "precision": 0.001 } }
}
`;

/** The configuration at `path`: JSON, or a module's default export. */
const loadConfig = async (path: string): Promise<ConvertConfig> => {
  const config: unknown = path.endsWith(".json")
    ? JSON.parse(await readFile(path, "utf8"))
    : ((await import(pathToFileURL(path).href)) as { default: unknown })
        .default;
  if (
    typeof config !== "object" ||
    config === null ||
    !("type" in config) ||
    !["rasters", "mesh", "polygons"].includes(config.type as string)
  ) {
    throw new Error(
      `${path} must set "type" to "rasters", "mesh" or "polygons".`,
    );
  }
  return config as ConvertConfig;
};

/** A file as a converter input, read when asked for. */
const fileInput = (path: string): Input => ({
  name: basename(path),
  read: () => readFile(path),
});

/** The files matching `patterns`, relative to `dir`, in name order. */
const filesOf = async (patterns: string[], dir: string) => {
  if (!Array.isArray(patterns)) {
    throw new Error(`"inputs" must be an array of file patterns.`);
  }
  const files = new Set<string>();
  for (const pattern of patterns) {
    let any = false;
    for await (const match of glob(pattern, { cwd: dir })) {
      files.add(resolve(dir, match));
      any = true;
    }
    if (!any) throw new Error(`${pattern} matches no file.`);
  }
  return [...files].sort();
};

/**
 * Runs `convert` into a new directory beside `output`, which replaces the
 * Zarr group at `output` once the conversion succeeds; anything else at
 * `output` is left alone and refused.
 */
const writeTo = async <T>(
  output: string,
  convert: (store: FileSystemStore) => Promise<T>,
): Promise<T> => {
  if (
    existsSync(output) &&
    !existsSync(join(output, "zarr.json")) &&
    !existsSync(join(output, ".zgroup"))
  ) {
    throw new Error(`${output} exists and is not a Zarr group.`);
  }
  mkdirSync(dirname(output), { recursive: true });
  const partial = mkdtempSync(`${output}.partial-`);
  try {
    const result = await convert(new FileSystemStore(partial));
    rmSync(output, { recursive: true, force: true });
    renameSync(partial, output);
    return result;
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    throw error;
  }
};

const datumOf = async (value: string | VerticalDatum, dir: string) => {
  if (value === "egm2008") return new Egm2008Geoid();
  if (value === "ellipsoid") return new Ellipsoid();
  if (VerticalDatum.is(value)) return value;
  const { default: datum } = (await import(
    pathToFileURL(resolve(dir, value)).href
  )) as { default: unknown };
  if (!VerticalDatum.is(datum)) {
    throw new Error(`${value} does not export a VerticalDatum by default.`);
  }
  return datum;
};

const projectionOf = async (
  value: string | Projection | undefined,
  dir: string,
): Promise<Projection | undefined> => {
  if (value === undefined || typeof value !== "string") return value;
  const zone = planeRectangularOf(value);
  if (zone) return zone;
  if (/^EPSG:/i.test(value)) {
    throw new Error(
      `${value} is not a JGD2011 plane rectangular zone (EPSG:6669 to EPSG:6687); give a module exporting a Projection instead.`,
    );
  }
  const { default: projection } = (await import(
    pathToFileURL(resolve(dir, value)).href
  )) as { default: unknown };
  if (
    typeof projection !== "object" ||
    projection === null ||
    typeof (projection as Projection).toGeographic !== "function"
  ) {
    throw new Error(`${value} does not export a Projection by default.`);
  }
  return projection as Projection;
};

const toleranceOf = ({
  maxLevelError,
  maxErrorShare = 0.01,
}: ConvertConfig): FloodTolerance | undefined => {
  if (maxErrorShare !== 0.01 && maxLevelError === undefined) {
    throw new Error("maxErrorShare needs maxLevelError.");
  }
  return maxLevelError === undefined
    ? undefined
    : { maxLevelError, maxErrorShare };
};

/** The properties to store with their precisions, units and labels. */
const propertiesOf = ({
  properties,
  precision = {},
  units = {},
  labels = {},
}: ConvertConfig): {
  properties?: PropertiesOption;
  precision: Record<string, number>;
  units: Record<string, string>;
  labels: Record<string, string>;
} => {
  if (!properties || typeof properties === "function") {
    return { properties, precision, units, labels };
  }
  const sources = new Map<string, string>();
  const precisions = { ...precision };
  const unitsOf = { ...units };
  const labelsOf = { ...labels };
  for (const [name, spec] of Object.entries(
    properties as Record<string, PropertyConfig>,
  )) {
    const {
      source = name,
      precision: step,
      units: unit,
      label,
    } = typeof spec === "string" ? { source: spec } : spec;
    sources.set(name, source);
    if (step !== undefined) precisions[name] = step;
    if (unit !== undefined) unitsOf[name] = unit;
    if (label !== undefined) labelsOf[name] = label;
  }
  const renamed = [...sources].some(([name, source]) => name !== source);
  return {
    properties: renamed
      ? (record: Record<string, unknown>) =>
          Object.fromEntries(
            [...sources].map(([name, source]) => [name, record[source]]),
          )
      : [...sources.keys()],
    precision: precisions,
    units: unitsOf,
    labels: labelsOf,
  };
};

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

/** The GPU memory a viewer needs, for tuning the frames kept. */
const reportTextures = ({
  water,
  flow,
  properties,
}: FloodZarrInfo["textureBytes"]) =>
  console.error(
    `GPU textures: ${megabytes(water)} for the water surface` +
      (flow === undefined ? "" : `, ${megabytes(flow)} for the flow`) +
      Object.entries(properties)
        .map(([name, bytes]) => `, ${megabytes(bytes)} for ${name} while shown`)
        .join(""),
  );

/** What a conversion onto a regular grid made, with `more` to tell. */
const reportRasters = (
  info: RastersInfo,
  { resolution }: { resolution?: number },
  more = "",
) => {
  console.error(
    `source ${info.sourceWidth} × ${info.sourceHeight} cells; ` +
      `grid ${info.dx.toFixed(1)} × ${info.dy.toFixed(1)} m (` +
      (resolution !== undefined ? "sampled" : describeGrid(info.grid)) +
      `), ${info.width} × ${info.height} cells, ${info.frameCount} of ${info.stepCount} frames, ` +
      `${info.wetCells} wet cells in ${info.tiles} tiles${more}`,
  );
  reportTextures(info.textureBytes);
};

const intervalOf = ({ interval = 0 }: ConvertConfig) =>
  typeof interval === "number" ? interval : parseDuration(interval);

/** The time options of a CSV or raster configuration. */
const timeOf = (config: MeshConfig | RastersConfig): TimeOptions => {
  const epoch = config.epoch ? new Date(parseUtc(config.epoch)) : undefined;
  if (epoch && Number.isNaN(epoch.getTime())) {
    throw new Error(`epoch ${config.epoch} is not a date.`);
  }
  return {
    time: "time" in config ? config.time : undefined,
    timePattern: config.timePattern
      ? new RegExp(config.timePattern)
      : undefined,
    timeUnit: config.timeUnit,
    epoch,
  };
};

const mesh = async (config: MeshConfig, dir: string) => {
  if (!config.input === !config.inputs) {
    throw new Error("Give either inputs (CSV) or input (netCDF).");
  }
  const files = config.input
    ? [resolve(dir, config.input)]
    : await filesOf(config.inputs ?? [], dir);
  const format = formatOf(files.map(fileInput), config.format, [
    "csv",
    "netcdf",
  ]);
  if ((format === "netcdf") !== !!config.input) {
    throw new Error(
      "A netCDF mesh is one file (input); CSV values are files (inputs).",
    );
  }
  const info = await writeTo(resolve(dir, config.output), async (output) => {
    const common = {
      output,
      projection: await projectionOf(config.projection, dir),
      resolution: config.resolution,
      maxEdge: config.maxEdge,
      level: config.level,
      ground: config.ground,
      depth: config.depth,
      minDepth: config.minDepth,
      datum: await datumOf(config.datum ?? "egm2008", dir),
      interval: intervalOf(config),
      tolerance: toleranceOf(config),
      ...propertiesOf(config),
    };
    if (format === "netcdf") {
      return convertMesh({
        ...common,
        input: fileInput(files[0]),
        mesh: config.mesh,
        epoch: timeOf(config).epoch,
      });
    }
    if (!config.position) throw new Error("CSV inputs need the position.");
    return convertMesh({
      ...common,
      inputs: files.map(fileInput),
      nodes: config.nodes ? fileInput(resolve(dir, config.nodes)) : undefined,
      faces: config.faces ? fileInput(resolve(dir, config.faces)) : undefined,
      faceNodes: config.faceNodes,
      id: config.id,
      valuesOn: config.valuesOn,
      position: config.position,
      ...timeOf(config),
    });
  });
  console.error(
    `mesh ${info.nodeCount} nodes, ${info.triangleCount} triangles` +
      (info.droppedTriangles
        ? ` (${info.droppedTriangles} longer than maxEdge dropped)`
        : "") +
      `; grid ${info.dx.toFixed(1)} × ${info.dy.toFixed(1)} m, ` +
      `${info.width} × ${info.height} cells, ${info.frameCount} of ${info.stepCount} frames, ` +
      `${info.wetCells} wet cells in ${info.tiles} tiles`,
  );
  reportTextures(info.textureBytes);
};

const rasters = async (config: RastersConfig, dir: string) => {
  const inputsOf = async (patterns: string[]) =>
    (await filesOf(patterns, dir)).map(fileInput);
  const fileOf = (path: string | undefined) =>
    path === undefined ? undefined : fileInput(resolve(dir, path));
  const inputs = await inputsOf(config.inputs);
  const format = formatOf(inputs, config.format, ["csv", "netcdf"]);
  const info = await writeTo(resolve(dir, config.output), async (output) => {
    const common = {
      inputs,
      output,
      projection: await projectionOf(config.projection, dir),
      resolution: config.resolution,
      datum: await datumOf(config.datum ?? "egm2008", dir),
      terrain: config.terrain,
      interval: intervalOf(config),
      tolerance: toleranceOf(config),
      ...propertiesOf(config),
    };
    const { time, ...byName } = timeOf(config);
    if (format === "csv") {
      return convertRasters({
        ...common,
        format,
        corners: config.corners,
        center: config.center,
        level: config.level,
        ground: config.ground,
        depth: config.depth,
        minDepth: config.minDepth,
        time,
        ...byName,
      });
    }
    if (time) throw new Error("Rasters are timed by name; give timePattern.");
    return convertRasters({
      ...common,
      format,
      series: Object.fromEntries(
        await Promise.all(
          Object.entries(config.series ?? {}).map(async ([name, patterns]) => [
            name,
            await inputsOf(patterns),
          ]),
        ),
      ),
      ground: fileOf(config.ground),
      groundScale: config.groundScale,
      buildings: fileOf(config.buildings),
      datumOffset: config.datumOffset,
      variable: config.variable,
      ...byName,
    });
  });
  reportRasters(info, config);
};

const polygons = async (config: PolygonsConfig, dir: string) => {
  const input = fileInput(resolve(dir, config.input));
  formatOf([input], config.format, ["czml"]);
  const info = await writeTo(resolve(dir, config.output), async (output) =>
    convertPolygons({
      input,
      output,
      datum: await datumOf(config.datum ?? "ellipsoid", dir),
      terrain: config.terrain,
      resolution: config.resolution,
      time: config.time,
      interval: intervalOf(config),
      tolerance: toleranceOf(config),
      ...propertiesOf(config),
    }),
  );
  reportRasters(
    info,
    config,
    `, ${info.uncovered} cell-steps outside the triangulation`,
  );
};

const [path] = process.argv.slice(2);
if (path === "--help" || path === "-h") {
  console.log(USAGE);
  process.exit(0);
}
if (!path) {
  console.error(USAGE);
  process.exit(1);
}
try {
  const file = resolve(path);
  const config = await loadConfig(file);
  const dir = dirname(file);
  if (config.type === "rasters") await rasters(config, dir);
  else if (config.type === "mesh") await mesh(config, dir);
  else await polygons(config, dir);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("Run navara-flood-zarr --help for usage.");
  process.exit(1);
}
