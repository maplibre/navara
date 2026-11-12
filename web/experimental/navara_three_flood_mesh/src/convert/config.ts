/**
 * The configuration file `navara-flood-zarr` converts by: the options of
 * `convertRasters`, `convertMesh` or `convertPolygons` as JSON, picked by the
 * shape of the data (`type`), with paths relative to the file. The format of
 * the inputs is their extension's unless `format` gives it. A JavaScript
 * module default-exporting the same object may hold what JSON cannot: a
 * `properties` callback and a `VerticalDatum` instance.
 */
import type { VerticalDatum } from "./datum";
import type { Projection } from "./projection";
import type { PropertiesCallback } from "./properties";
import type { CoordinateColumns } from "./table";
import type { Terrain } from "./terrain";

/**
 * A property to store: its source name, or that with the precision to pack
 * it at, its unit and its description.
 */
export type PropertyConfig =
  | string
  | { source?: string; precision?: number; units?: string; label?: string };

type CommonConfig = {
  /** The Zarr group to write, replacing the one there. */
  output: string;
  /** Thins the steps to no closer than this: seconds, or `"30m"`, `"1h"`. */
  interval?: number | string;
  /** Keeps only the steps the others do not interpolate to within it. */
  maxLevelError?: number;
  /** The share of wet cells `maxLevelError` may be exceeded for (0.01). */
  maxErrorShare?: number;
  /**
   * Properties to store, by name: the source name to take as is, or its
   * source and precision. A module may give a callback instead, deriving
   * them (see `PropertiesCallback`), with the precisions in `precision`.
   * `flow_east` and `flow_north` store the flow velocity in m/s.
   */
  properties?: Record<string, PropertyConfig> | PropertiesCallback;
  precision?: Record<string, number>;
  units?: Record<string, string>;
  labels?: Record<string, string>;
  /**
   * Datum of the heights: `"egm2008"`, `"ellipsoid"`, or the path of a
   * module default-exporting a `VerticalDatum`; a module may give the
   * instance. EGM2008 for rasters and meshes by default, the ellipsoid for
   * polygons.
   */
  datum?: string | VerticalDatum;
};

/**
 * The terrain to sample the ground height from where the data has none: a
 * `raster-dem` source as `addSource` takes it, of heights above the WGS84
 * ellipsoid, sampled as `sampleTerrainMostDetailed` does; or, in a module, a
 * `TerrainSampler`.
 */
export type TerrainConfig = Terrain;

export type MeshConfig = CommonConfig & {
  type: "mesh";
  /** The format of the inputs: `.csv` is CSV, `.nc` or `.sww` netCDF. */
  format?: "csv" | "netcdf";
  /** CSV files of the values, or glob patterns matching them. */
  inputs?: string[];
  /**
   * A netCDF file of the mesh and its values over time instead: UGRID, or
   * triangles in `x`, `y` and `volumes`. The CSV options do not apply to
   * it; `level`, `ground` and `depth` name its variables.
   */
  input?: string;
  /** The UGRID mesh topology variable, when the file holds more than one. */
  mesh?: string;
  /** The CSV of the nodes, and of the faces. */
  nodes?: string;
  faces?: string;
  faceNodes?: string[];
  id?: string;
  valuesOn?: "nodes" | "faces";
  position?: CoordinateColumns;
  /** As in `RastersConfig`. */
  projection?: string | Projection;
  /** Cell size in meters of the grid the mesh is sampled at. */
  resolution: number;
  /** Without faces, the longest triangle edge in meters kept. */
  maxEdge?: number;
  level?: string;
  ground?: string;
  depth?: string;
  minDepth?: number;
  time?: string;
  /** A regular expression whose first group picks the time out of a file name. */
  timePattern?: string;
  timeUnit?: "seconds" | "minutes" | "hours" | number;
  epoch?: string;
};

/**
 * A regular grid: CSV files of its wet cells, or netCDF rasters, each one
 * time step. The options marked CSV or netCDF apply to that format only.
 */
export type RastersConfig = CommonConfig & {
  type: "rasters";
  /** The format of the inputs: `.csv` is CSV, `.nc` or `.grd` netCDF. */
  format?: "csv" | "netcdf";
  /**
   * The CSV files, or the rasters of the water level; or glob patterns
   * matching them.
   */
  inputs: string[];
  /**
   * The projection of the coordinates: a JGD2011 plane rectangular zone by
   * its EPSG code (`"EPSG:6669"` to `"EPSG:6687"`), or the path of a module
   * default-exporting a `Projection`; a module may give the instance.
   */
  projection?: string | Projection;
  /**
   * Cell size in meters to sample the cells at; without it, the cells, in
   * degrees, are written as they are.
   */
  resolution?: number;
  /** CSV: columns of two opposite corners or all four, as `[lng, lat]` each. */
  corners?: CoordinateColumns[];
  /** CSV: columns of the center instead. */
  center?: CoordinateColumns;
  /** CSV: the column of the level, or of the ground and the depth. */
  level?: string;
  /** CSV: the column of the ground height. netCDF: a raster of it. */
  ground?: string;
  depth?: string;
  minDepth?: number;
  /** CSV: the column of the time, instead of `timePattern`. */
  time?: string;
  /** netCDF: more rasters per step by name, for `properties` to take. */
  series?: Record<string, string[]>;
  /** Without `ground`, terrain to take it from; see `TerrainConfig`. */
  terrain?: TerrainConfig;
  /** netCDF: multiplies the ground raster, such as by -1 for depths below the datum. */
  groundScale?: number;
  /** netCDF: a raster that is nonzero where buildings stand. */
  buildings?: string;
  /** netCDF: height of the level the heights count from, added to them. */
  datumOffset?: number;
  /** netCDF: the variable read from each file, when it holds more than one. */
  variable?: string;
  /** A regular expression whose first group picks the time out of a file name. */
  timePattern?: string;
  timeUnit?: "seconds" | "minutes" | "hours" | number;
  epoch?: string;
};

export type PolygonsConfig = CommonConfig & {
  type: "polygons";
  format?: "czml";
  /** The CZML file. */
  input: string;
  resolution?: number;
  /** Which end of its availability interval times a step (`"start"`). */
  time?: "start" | "end";
  /** Terrain to take the ground height from; see `TerrainConfig`. */
  terrain?: TerrainConfig;
};

export type ConvertConfig = RastersConfig | MeshConfig | PolygonsConfig;
