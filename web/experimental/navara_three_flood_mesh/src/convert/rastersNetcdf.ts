import type { Input } from "./input";
import { readRaster, type Raster } from "./raster";
import type { RasterSamplingOptions, RasterSeries } from "./rasters";
import { timeReader, type TimeOptions } from "./table";

export type RastersNetcdfOptions = RasterSamplingOptions &
  Omit<TimeOptions, "time"> & {
    format?: "netcdf";
    /**
     * Rasters of the water level, one per time step, timed by `timePattern`;
     * a missing value is dry. See `readRaster` for the formats read.
     */
    inputs: Input[];
    /**
     * More rasters per time step, by name, the fields `properties` takes:
     * each a file per step of `inputs`, timed by `timePattern` as well.
     */
    series?: Record<string, Input[]>;
    /**
     * A raster of the ground height, on the grid of the levels. It is stored
     * as the `ground` property, in the same datum as the levels, and the
     * group's `ground` attribute names it, so `loadTimeSeriesFlood` derives
     * the depth from it.
     */
    ground?: Input;
    /** Multiplies the ground raster, such as by -1 for depths below the datum. */
    groundScale?: number;
    /**
     * A raster that is nonzero where buildings stand, which a simulation
     * keeps dry; see `RasterSeries.excluded`.
     */
    buildings?: Input;
    /**
     * Height in `datum` of the level the heights count from, such as the tide
     * a simulation starts at; added to the levels and the ground.
     */
    datumOffset?: number;
    /** The variable read from each file, when it holds more than one. */
    variable?: string;
  };

const sameGrid = (a: Raster, b: Raster) =>
  a.width === b.width &&
  a.height === b.height &&
  Math.abs(a.x0 - b.x0) < 1e-6 * Math.abs(a.dx) + 1e-9 &&
  Math.abs(a.y0 - b.y0) < 1e-6 * Math.abs(a.dy) + 1e-9 &&
  Math.abs(a.dx - b.dx) < 1e-6 * Math.abs(a.dx) &&
  Math.abs(a.dy - b.dy) < 1e-6 * Math.abs(a.dy);

/**
 * The series of rasters, one file per step, read a step at a time. Only the
 * first level raster is read here, for the grid the others must share.
 */
export const readRastersNetcdf = async (
  options: RastersNetcdfOptions,
): Promise<RasterSeries> => {
  const {
    inputs,
    series = {},
    ground,
    groundScale = 1,
    buildings,
    datumOffset = 0,
    variable,
  } = options;
  if (!inputs.length) throw new Error("No level rasters.");
  if (!options.timePattern) {
    throw new Error("Give the timePattern the rasters are timed by.");
  }
  const timing = timeReader(options);
  const files = inputs
    .map((input) => ({ input, t: timing.fileTime(input) as number }))
    .sort((a, b) => a.t - b.t);
  const seriesAt = Object.entries(series).map(([name, files]) => {
    const byTime = new Map(files.map((i) => [timing.fileTime(i), i]));
    return { name, at: (t: number) => byTime.get(t) };
  });

  const first = await readRaster(files[0].input, variable);
  const read = async (input: Input) => {
    const raster = await readRaster(input, variable);
    if (!sameGrid(raster, first)) {
      throw new Error(`${input.name} is not on the grid of the others.`);
    }
    return raster.values;
  };
  const raised = (values: Float32Array, scale = 1) =>
    scale === 1 && datumOffset === 0
      ? values
      : values.map((v) => v * scale + datumOffset);

  const { width, height, x0, y0, dx, dy } = first;
  return {
    source:
      files.length === 1
        ? files[0].input.name
        : `${files.length} level rasters`,
    width,
    height,
    x0,
    y0,
    dx,
    dy,
    ground: ground && raised(await read(ground), groundScale),
    excluded:
      buildings &&
      (await read(buildings)).map((v) => (v !== 0 && !Number.isNaN(v) ? 1 : 0)),
    times: files.map(({ t }) => t),
    step: async (k) => {
      const { input, t } = files[k];
      const fields: Record<string, Float32Array> = {};
      for (const { name, at } of seriesAt) {
        const source = at(t);
        if (!source) {
          throw new Error(`Series ${name} has no raster at ${input.name}.`);
        }
        fields[name] = await read(source);
      }
      return {
        levels: raised(k === 0 ? first.values : await read(input)),
        fields,
      };
    },
  };
};
