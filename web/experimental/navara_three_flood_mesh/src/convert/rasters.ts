import {
  cellCenter,
  cellOffsets,
  Egm2008Geoid,
  type VerticalDatum,
} from "./datum";
import {
  fitGrid,
  gridOfResolution,
  METERS_PER_DEGREE_LAT,
  METERS_PER_DEGREE_LNG_AT_EQUATOR,
  type Grid,
} from "./grid";
import { formatOf } from "./input";
import type { Projection } from "./projection";
import { PropertyCollector, type PropertiesOption } from "./properties";
import type { Raster } from "./raster";
import { terrainSamplerOf } from "./rasterDem";
import { readRastersCsv, type RastersCsvOptions } from "./rastersCsv";
import { readRastersNetcdf, type RastersNetcdfOptions } from "./rastersNetcdf";
import { GROUND_PROPERTY, groundStorage } from "./table";
import type { Terrain } from "./terrain";
import { thinTimes } from "./time";
import {
  writeFloodZarr,
  type FloodFrame,
  type FloodStore,
  type FloodTolerance,
  type FloodZarrInfo,
} from "./zarr";

// A center further than this, in cells, from a grid cell's is off the grid.
export const CENTER_TOLERANCE = 0.05;

/** How a raster series is sampled and written, whatever its source format. */
export type RasterSamplingOptions = {
  /** The store to write the Zarr group to; see `writeFloodZarr`. */
  output: FloodStore;
  /**
   * The projection of the source coordinates, such as a `PlaneRectangular`
   * zone; without it, they are in degrees.
   */
  projection?: Projection;
  /**
   * Cell size in meters of the grid the source cells are sampled at. Each
   * cell averages the source cells within it, or takes the nearest where
   * they are larger: it is wet where at least half of them are, at their
   * mean level. Without it, the source cells, in degrees, are the cells.
   */
  resolution?: number;
  /** Datum of the heights; orthometric heights over EGM2008 by default. */
  datum?: VerticalDatum;
  /**
   * For a series without the ground height, the terrain to sample it from
   * at the center of each cell, stored as the `ground` property as one the
   * series gives would be: a `raster-dem` source or a `TerrainSampler`.
   */
  terrain?: Terrain;
  /** Seconds the steps are thinned to no closer than. */
  interval?: number;
  /** Keeps only the steps the others do not interpolate to. */
  tolerance?: FloodTolerance;
  /**
   * Properties stored with each cell: names of the source's fields to take,
   * or a callback given the fields averaged over the cell's wet source
   * cells, by name.
   */
  properties?: PropertiesOption;
  /** Per property, the step to store it at; see `FloodSeries.precision`. */
  precision?: Record<string, number>;
  /** Per property, its unit, such as `"m/s"`. */
  units?: Record<string, string>;
  /** Per property, its description. */
  labels?: Record<string, string>;
};

export type RastersInfo = FloodZarrInfo & {
  grid: Grid;
  /** Steps read, before keyframes are picked. */
  stepCount: number;
  /** Size of the source rasters, in their cells. */
  sourceWidth: number;
  sourceHeight: number;
};

/** The values of one time step at the source cells, row-major. */
export type RasterStep = {
  /** The water level; NaN where dry. */
  levels: ArrayLike<number>;
  /** Per field, its value; NaN where missing. */
  fields: Record<string, ArrayLike<number>>;
};

/**
 * A time series of water levels on a regular grid, as read: values at the
 * centers of its cells, placed as a `Raster`'s.
 */
export type RasterSeries = Omit<Raster, "values"> & {
  /** Names the source in the group's attributes. */
  source: string;
  /** The ground height at each source cell; NaN where unknown. */
  ground?: ArrayLike<number>;
  /**
   * Nonzero at the source cells left out of every cell, such as buildings,
   * which a simulation keeps dry: out of its share of wet cells and of its
   * means.
   */
  excluded?: ArrayLike<number>;
  /**
   * Per step, the exact shoreline as segments `x0, y0, x1, y1` in source
   * cells, cell `c, r` spanning `[c, c + 1]` by `[r, r + 1]`, for outlines
   * that do not follow the cells.
   */
  shorelines?: Float64Array[];
  /** Seconds since the Unix epoch of each step, increasing. */
  times: ArrayLike<number>;
  /** The values of step `k`. */
  step: (k: number) => RasterStep | Promise<RasterStep>;
};

/** CSV files of the cells (`format: "csv"`) or rasters (`"netcdf"`). */
export type RastersOptions = RastersCsvOptions | RastersNetcdfOptions;

/**
 * Converts a time series of water levels on a regular grid, as CSV files of
 * the wet cells or a netCDF raster per time step, into the Zarr group
 * `loadTimeSeriesFlood` reads; see `RasterSamplingOptions.resolution` for
 * how they are sampled. Without `format`, the extension of the first input
 * gives it.
 */
export const convertRasters = async (
  options: RastersOptions,
): Promise<RastersInfo> =>
  sampleRasters(
    formatOf(options.inputs, options.format, ["csv", "netcdf"]) === "csv"
      ? await readRastersCsv(options as RastersCsvOptions)
      : await readRastersNetcdf(options as RastersNetcdfOptions),
    options,
  );

/** The grid's cells, each with the source columns and rows it spans. */
type Cells = {
  grid: Grid;
  x: Int32Array;
  y: Int32Array;
  /** Per cell, its first source column, past its last, and so its rows. */
  spans: Int32Array;
};

/** The source cells as the cells of a grid in degrees. */
const sourceCells = ({ width, height, x0, y0, dx, dy }: RasterSeries) => {
  // One center always fits; the grid may snap to a standard mesh division.
  const grid = fitGrid(dx, dy, [x0], [y0], 0.5, CENTER_TOLERANCE) as Grid;
  const count = width * height;
  const x = new Int32Array(count);
  const y = new Int32Array(count);
  const spans = new Int32Array(4 * count);
  for (let r = 0; r < height; r++) {
    const row = Math.round((y0 + r * dy - grid.latOffset) / grid.latStep - 0.5);
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      x[i] = Math.round((x0 + c * dx - grid.lngOffset) / grid.lngStep - 0.5);
      y[i] = row;
      spans.set([c, c + 1, r, r + 1], 4 * i);
    }
  }
  return { grid, x, y, spans };
};

/**
 * The cells of a grid of `resolution`-meter cells over the source cells,
 * each spanning the source cells within it, or at least the nearest.
 */
const sampledCells = (
  { width, height, x0, y0, dx, dy }: RasterSeries,
  toGeographic: (x: number, y: number) => number[],
  bounds: { west: number; south: number; east: number; north: number },
  resolution: number,
): Cells => {
  // The Jacobian of the projection at the middle, in degrees per source
  // cell, sizes the cells and seeds inverting it.
  const cx = x0 + ((width - 1) / 2) * dx;
  const cy = y0 + ((height - 1) / 2) * dy;
  const [lng0, lat0] = toGeographic(cx, cy);
  const [lngC, latC] = toGeographic(cx + dx, cy);
  const [lngR, latR] = toGeographic(cx, cy + dy);
  const j = [lngC - lng0, lngR - lng0, latC - lat0, latR - lat0];
  const det = j[0] * j[3] - j[1] * j[2];
  const kx =
    METERS_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  const ky = METERS_PER_DEGREE_LAT;
  const columnMeters = Math.hypot(j[0] * kx, j[2] * ky);
  const rowMeters = Math.hypot(j[1] * kx, j[3] * ky);

  /** The source column and row (fractional) at `lng`, `lat`. */
  const sourceAt = (lng: number, lat: number, guess: [number, number]) => {
    let [c, r] = guess;
    for (let i = 0; i < 4; i++) {
      const [l, a] = toGeographic(x0 + c * dx, y0 + r * dy);
      const dl = lng - l;
      const da = lat - a;
      const dc = (j[3] * dl - j[1] * da) / det;
      const dr = (j[0] * da - j[2] * dl) / det;
      c += dc;
      r += dr;
      if (Math.abs(dc) + Math.abs(dr) < 1e-4) break;
    }
    return [c, r] as [number, number];
  };

  const { west, south, east, north } = bounds;
  const grid = gridOfResolution(resolution, (south + north) / 2);
  const halfColumns = Math.max(resolution / columnMeters / 2, 0.5);
  const halfRows = Math.max(resolution / rowMeters / 2, 0.5);
  const cellX: number[] = [];
  const cellY: number[] = [];
  const spanList: number[] = [];
  const gx0 = Math.floor((west - grid.lngOffset) / grid.lngStep);
  const gx1 = Math.ceil((east - grid.lngOffset) / grid.lngStep);
  const gy0 = Math.floor((south - grid.latOffset) / grid.latStep);
  const gy1 = Math.ceil((north - grid.latOffset) / grid.latStep);
  let guess: [number, number] = [(width - 1) / 2, (height - 1) / 2];
  for (let y = gy0; y < gy1; y++) {
    for (let x = gx0; x < gx1; x++) {
      const lng = (x + 0.5) * grid.lngStep + grid.lngOffset;
      const lat = (y + 0.5) * grid.latStep + grid.latOffset;
      const [c, r] = (guess = sourceAt(lng, lat, guess));
      const c0 = Math.max(Math.ceil(c - halfColumns), 0);
      const c1 = Math.min(Math.floor(c + halfColumns) + 1, width);
      const r0 = Math.max(Math.ceil(r - halfRows), 0);
      const r1 = Math.min(Math.floor(r + halfRows) + 1, height);
      // Cells mostly off the source cells are left out.
      const inside = Math.max(c1 - c0, 0) * Math.max(r1 - r0, 0);
      if (inside * 2 < 4 * halfColumns * halfRows) continue;
      cellX.push(x);
      cellY.push(y);
      spanList.push(c0, c1, r0, r1);
    }
  }
  return {
    grid,
    x: Int32Array.from(cellX),
    y: Int32Array.from(cellY),
    spans: Int32Array.from(spanList),
  };
};

/** Samples `series` on the grid and writes it to `options.output`. */
export const sampleRasters = async (
  series: RasterSeries,
  options: RasterSamplingOptions,
): Promise<RastersInfo> => {
  const {
    output,
    projection,
    resolution,
    datum = new Egm2008Geoid(),
    terrain,
    interval = 0,
    tolerance,
    properties,
    precision,
    units,
    labels,
  } = options;
  const { width, height, x0, y0, dx, dy, excluded } = series;
  if (resolution === undefined && projection) {
    throw new Error(
      "Source cells in a projection are sampled at a resolution; give one.",
    );
  }
  const toGeographic = (x: number, y: number) =>
    projection ? projection.toGeographic(x, y) : [x, y];
  const bounds = {
    west: Infinity,
    east: -Infinity,
    south: Infinity,
    north: -Infinity,
  };
  for (const [c, r] of [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]) {
    const [lng, lat] = toGeographic(x0 + c * dx, y0 + r * dy);
    bounds.west = Math.min(bounds.west, lng);
    bounds.east = Math.max(bounds.east, lng);
    bounds.south = Math.min(bounds.south, lat);
    bounds.north = Math.max(bounds.north, lat);
  }
  const {
    grid,
    x: cellX,
    y: cellY,
    spans,
  } = resolution === undefined
    ? sourceCells(series)
    : sampledCells(series, toGeographic, bounds, resolution);
  const cellCount = cellX.length;
  if (!cellCount) throw new Error("The source cells cover no cell.");

  // The source cells not left out, and how many each cell spans.
  const open = Uint8Array.from({ length: width * height }, (_, index) =>
    excluded?.[index] ? 0 : 1,
  );
  const openCounts = Int32Array.from({ length: cellCount }, (_, i) => {
    let count = 0;
    for (let r = spans[4 * i + 2]; r < spans[4 * i + 3]; r++) {
      for (let c = spans[4 * i]; c < spans[4 * i + 1]; c++) {
        count += open[r * width + c];
      }
    }
    return count;
  });

  /** The mean of `values` over cell `i`'s source cells where `wet`. */
  const meanOver = (
    i: number,
    values: ArrayLike<number>,
    wet: (index: number) => boolean,
  ) => {
    let sum = 0;
    let count = 0;
    for (let r = spans[4 * i + 2]; r < spans[4 * i + 3]; r++) {
      for (let c = spans[4 * i]; c < spans[4 * i + 1]; c++) {
        const index = r * width + c;
        const v = values[index];
        if (wet(index) && !Number.isNaN(v)) {
          sum += v;
          count++;
        }
      }
    }
    return count ? sum / count : NaN;
  };

  const { ground } = series;
  if (ground && terrain) {
    throw new Error("The series has the ground height; leave out terrain.");
  }
  const sampleTerrain = terrain && terrainSamplerOf(terrain);
  const cellGround =
    ground &&
    Float64Array.from({ length: cellCount }, (_, i) =>
      meanOver(i, ground, (index) => open[index] === 1),
    );
  const collector = properties && new PropertyCollector(properties);
  const kept = thinTimes(series.times, interval);
  const steps: {
    cells: Int32Array;
    levels: Float32Array;
    values: Map<string, Float32Array>;
  }[] = [];
  for (const k of kept) {
    const { levels, fields } = await series.step(k);
    const wet = (index: number) =>
      open[index] === 1 && !Number.isNaN(levels[index]);
    const cells: number[] = [];
    const cellLevels: number[] = [];
    const cellValues = new Map<string, number[]>();
    for (let i = 0; i < cellCount; i++) {
      let wetCount = 0;
      for (let r = spans[4 * i + 2]; r < spans[4 * i + 3]; r++) {
        for (let c = spans[4 * i]; c < spans[4 * i + 1]; c++) {
          if (wet(r * width + c)) wetCount++;
        }
      }
      if (!wetCount || wetCount * 2 < openCounts[i]) continue;
      cells.push(i);
      cellLevels.push(meanOver(i, levels, wet));
      if (!collector) continue;
      // A field without a value in the cell is missing, not malformed.
      const record = Object.fromEntries(
        Object.entries(fields).map(([name, values]) => {
          const mean = meanOver(i, values, wet);
          return [name, Number.isNaN(mean) ? undefined : mean];
        }),
      );
      const values = collector.collect(record);
      for (const name of collector.names) {
        const list = cellValues.get(name) ?? [];
        // A property first seen on a later cell is missing on the earlier.
        while (list.length < cells.length - 1) list.push(NaN);
        list.push(values[name] ?? NaN);
        cellValues.set(name, list);
      }
    }
    steps.push({
      cells: Int32Array.from(cells),
      levels: Float32Array.from(cellLevels),
      values: new Map(
        [...cellValues].map(([name, list]) => [name, Float32Array.from(list)]),
      ),
    });
  }
  collector?.report();
  const written = collector?.written ?? [];
  const storage = groundStorage(
    (ground || terrain) && GROUND_PROPERTY,
    written,
    {
      precision,
      units,
      labels,
    },
  );

  // The datum and the terrain at the center of every cell ever wet, each
  // sampled at once.
  const wetCells = [...new Set(steps.flatMap(({ cells }) => [...cells]))];
  const offsets = await cellOffsets(datum, grid, cellX, cellY, wetCells);
  const terrainGround = new Float64Array(cellCount).fill(NaN);
  if (sampleTerrain && storage.stores) {
    const heights = await sampleTerrain(
      wetCells.map((i) => cellCenter(grid, cellX[i], cellY[i])),
    );
    wetCells.forEach((i, k) => {
      terrainGround[i] = heights[k]?.height ?? NaN;
    });
  }

  const frames: FloodFrame[] = steps.map(({ cells, levels, values }) => {
    const n = cells.length;
    const frameProperties: Record<string, Float32Array> = {};
    for (const name of written) {
      const list = values.get(name);
      frameProperties[name] = Float32Array.from({ length: n }, (_, r) =>
        list && r < list.length ? list[r] : NaN,
      );
    }
    if (storage.stores) {
      frameProperties[GROUND_PROPERTY] = Float32Array.from(cells, (i) =>
        cellGround ? cellGround[i] + offsets[i] : terrainGround[i],
      );
    }
    return {
      x: Int32Array.from(cells, (i) => cellX[i]),
      y: Int32Array.from(cells, (i) => cellY[i]),
      level: Float32Array.from(levels, (v, r) => v + offsets[cells[r]]),
      properties: frameProperties,
    };
  });

  // The shorelines from source cells to the grid's nodes.
  const { shorelines } = series;
  const toNodes = (segments: Float64Array) => {
    const out = new Float64Array(segments.length);
    for (let i = 0; i < segments.length; i += 2) {
      const [lng, lat] = toGeographic(
        x0 + (segments[i] - 0.5) * dx,
        y0 + (segments[i + 1] - 0.5) * dy,
      );
      out[i] = (lng - grid.lngOffset) / grid.lngStep;
      out[i + 1] = (lat - grid.latOffset) / grid.latStep;
    }
    return out;
  };

  const info = await writeFloodZarr(output, {
    grid,
    times: Float64Array.from(kept, (k) => series.times[k]),
    frames,
    shorelines: shorelines && kept.map((k) => toNodes(shorelines[k])),
    attributes: {
      source: series.source,
      source_vertical_datum: datum.name,
      ...(projection && { source_projection: projection.name }),
      ...storage.attributes,
    },
    tolerance,
    precision: storage.precision,
    units: storage.units,
    labels: storage.labels,
  });
  return {
    ...info,
    grid,
    stepCount: steps.length,
    sourceWidth: width,
    sourceHeight: height,
  };
};
