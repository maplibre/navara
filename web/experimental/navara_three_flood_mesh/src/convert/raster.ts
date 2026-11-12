/**
 * Gridded values read from a netCDF file.
 */
import type { Input } from "./input";
import { unpack, withNetcdf, type NetcdfVariable } from "./netcdf";

/** Values at the nodes of a regular grid, in a projection or in degrees. */
export type Raster = {
  width: number;
  height: number;
  /** Coordinates of the first column and row, the western and southern. */
  x0: number;
  y0: number;
  /** Steps between columns and between rows, positive. */
  dx: number;
  dy: number;
  /** Row-major, row `j` at `y0 + j * dy`; NaN where missing. */
  values: Float32Array;
};

const COLUMN_NAMES = ["x", "lon", "longitude", "easting"];
const ROW_NAMES = ["y", "lat", "latitude", "northing"];

/** The first and step of evenly spaced `values`, or an error naming them. */
const spacingOf = (values: ArrayLike<number>, name: string) => {
  const n = values.length;
  const step = n > 1 ? (values[n - 1] - values[0]) / (n - 1) : NaN;
  // Float32 coordinates are off by up to a few units in the last place of
  // their magnitude, which a fine step in degrees does not cover.
  const float32 = Array.prototype.every.call(
    values,
    (v: number) => Math.fround(v) === v,
  );
  const tolerance =
    1e-3 * Math.abs(step) +
    (float32
      ? 2 ** -21 * Math.max(Math.abs(values[0]), Math.abs(values[n - 1]))
      : 0);
  for (let i = 1; i < n; i++) {
    if (Math.abs(values[i] - values[0] - i * step) > tolerance) {
      throw new Error(`The ${name} coordinates are not evenly spaced.`);
    }
  }
  if (!(step !== 0 && Number.isFinite(step))) {
    throw new Error(`The ${name} coordinates have no step.`);
  }
  return { first: values[0], step };
};

/**
 * The raster of `variable` (or the only 2-D one) with its 1-D coordinates,
 * or, in the legacy layout, of `z` placed by `x_range`, `y_range` and
 * `dimension`, its rows from the north.
 */
const rasterOf = (
  variables: Map<string, NetcdfVariable>,
  variable: string | undefined,
  name: string,
): Raster => {
  const legacy = variables.get("z");
  const dimension = variables.get("dimension");
  const xRange = variables.get("x_range");
  const yRange = variables.get("y_range");
  if (
    !variable &&
    legacy?.shape.length === 1 &&
    dimension &&
    xRange &&
    yRange
  ) {
    const [width, height] = Array.from(dimension.read());
    const [west, east] = Array.from(xRange.read());
    const [south, north] = Array.from(yRange.read());
    // Pixel registration places the values at the cell centers.
    const pixel = legacy.attributes.node_offset?.[0] === 1 ? 1 : 0;
    const dx = (east - west) / (width - 1 + pixel);
    const dy = (north - south) / (height - 1 + pixel);
    return grid(legacy, width, height, {
      x0: west + (pixel * dx) / 2,
      y0: north - (pixel * dy) / 2,
      dx,
      dy: -dy,
    });
  }
  const grids = [...variables].filter(([, v]) => v.shape.length === 2);
  const found = variable
    ? grids.find(([key]) => key === variable)
    : grids.length === 1
      ? grids[0]
      : undefined;
  if (!found) {
    throw new Error(
      variable
        ? `${name} has no 2-D variable ${variable}.`
        : `${name} has ${grids.length} 2-D variables; name one.`,
    );
  }
  const [, values] = found;
  const [height, width] = values.shape;
  const axis = (names: string[], length: number, which: string) => {
    const match = [...variables].find(
      ([key, v]) =>
        names.includes(key.toLowerCase()) &&
        v.shape.length === 1 &&
        v.shape[0] === length,
    );
    if (!match) throw new Error(`${name} has no ${which} coordinates.`);
    return spacingOf(match[1].read(), which);
  };
  const columns = axis(COLUMN_NAMES, width, "column");
  const rows = axis(ROW_NAMES, height, "row");
  return grid(values, width, height, {
    x0: columns.first,
    y0: rows.first,
    dx: columns.step,
    dy: rows.step,
  });
};

/**
 * The values of `variable` as a raster on `width` × `height` nodes, turned
 * to ascending columns and rows. The fill value is read as NaN, and CF
 * `scale_factor` and `add_offset` are applied.
 */
const grid = (
  variable: NetcdfVariable,
  width: number,
  height: number,
  placement: { x0: number; y0: number; dx: number; dy: number },
): Raster => {
  const unpacked = unpack(variable, variable.read());
  const flipX = placement.dx < 0;
  const flipY = placement.dy < 0;
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const row = flipY ? height - 1 - r : r;
    for (let c = 0; c < width; c++) {
      values[r * width + c] =
        unpacked[row * width + (flipX ? width - 1 - c : c)];
    }
  }
  const { x0, y0, dx, dy } = placement;
  return {
    width,
    height,
    x0: flipX ? x0 + (width - 1) * dx : x0,
    y0: flipY ? y0 + (height - 1) * dy : y0,
    dx: Math.abs(dx),
    dy: Math.abs(dy),
    values,
  };
};

/**
 * Reads the 2-D variable `variable` of a netCDF file with its 1-D
 * coordinates; without `variable`, the file's only 2-D one, or the `z` of
 * the legacy layout. See `withNetcdf` for the formats read.
 */
export const readRaster = (input: Input, variable?: string): Promise<Raster> =>
  withNetcdf(input, (file) => rasterOf(file.variables, variable, input.name));
