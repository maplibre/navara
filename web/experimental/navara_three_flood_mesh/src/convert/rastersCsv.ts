import { boundsOf, fitGrid } from "./grid";
import type { Input } from "./input";
import {
  CENTER_TOLERANCE,
  type RasterSamplingOptions,
  type RasterSeries,
} from "./rasters";
import {
  numberOf,
  readTable,
  timeReader,
  type CoordinateColumns,
  type TimeOptions,
} from "./table";

export type RastersCsvOptions = RasterSamplingOptions &
  TimeOptions & {
    format?: "csv";
    /**
     * CSV files, one row per wet cell and time; a cell without a row is dry. A file's header is its first
     * line naming every column asked for; lines before it are skipped. UTF-8
     * and Shift_JIS are recognized. A field may be quoted, but not span lines.
     */
    inputs: Input[];
    /**
     * Columns of the cell's corners in degrees, or with `projection`, in its
     * easting and northing: two opposite corners or all four. They also give
     * the cell size.
     */
    corners?: CoordinateColumns[];
    /**
     * Columns of the cell's center, for cells given by it instead. The cell
     * size is then the centers' spacing.
     */
    center?: CoordinateColumns;
    /**
     * Column of the water level, or `ground` and `depth`, which add up to it.
     * The ground height is then also stored as the `ground` property, in the
     * same datum as the levels, and the group's `ground` attribute names it,
     * so `loadTimeSeriesFlood` derives the depth from it.
     */
    level?: string;
    ground?: string;
    depth?: string;
    /** With `depth`, drops shallower cells. */
    minDepth?: number;
  };

/** The rows of one time step. */
type Group = {
  xs: number[];
  ys: number[];
  levels: number[];
  grounds: number[];
  fields: Record<string, number[]>;
};

/**
 * Reads the cells of CSV files, such as of a Japanese standard mesh, as a
 * series on the regular grid they lie on, in their own coordinates. Its fields are the columns `properties` names,
 * or for a callback, every column but the position and the time, parsed as
 * numbers.
 */
export const readRastersCsv = async (
  options: RastersCsvOptions,
): Promise<RasterSeries> => {
  const {
    inputs,
    corners,
    center,
    level,
    ground,
    depth,
    minDepth = -Infinity,
    time,
    interval = 0,
    properties,
  } = options;
  if (!inputs.length) throw new Error("No input.");
  if (corners && center) {
    throw new Error("Give either corners or center, not both.");
  }
  const positions = corners ?? (center && [center]);
  if (!positions) throw new Error("Give the corners or the center.");
  if (corners && corners.length !== 2 && corners.length !== 4) {
    throw new Error("Give two opposite corners or all four.");
  }
  if (!level === !(ground && depth)) {
    throw new Error("Give either level or both ground and depth.");
  }
  const timing = timeReader(options);
  // Files timed by name and not kept are not read.
  const files = timing.kept(inputs, interval);

  const named = Array.isArray(properties) ? properties : [];
  const wanted = [
    ...positions.flat(),
    ...[level, ground, depth, time].filter((c): c is string => !!c),
    ...named,
  ];
  // The corners' extent summed over the rows, giving the cell size.
  const extent = { x: 0, y: 0, rows: 0 };
  const xValues = new Set<number>();
  const yValues = new Set<number>();
  const byTime = new Map<number, Group>();
  for (const input of files) {
    const { header, index, rows } = await readTable(input, wanted);
    const xIndices = positions.map(([column]) => index(column));
    const yIndices = positions.map(([, column]) => index(column));
    const levelIndex = level ? index(level) : -1;
    const groundIndex = ground ? index(ground) : -1;
    const depthIndex = depth ? index(depth) : -1;
    const timeIndex = time ? index(time) : -1;
    const fileTime = timing.fileTime(input);
    const fieldNames = properties
      ? named.length
        ? named
        : header.filter((c) => !positions.flat().includes(c) && c !== time)
      : [];
    const fieldIndices = fieldNames.map(index);

    const numbers = (fields: string[], indices: number[]) =>
      indices.map((i) => numberOf(fields[i]));
    const mean = (values: number[]) =>
      values.reduce((a, b) => a + b, 0) / values.length;
    const spread = (values: number[]) =>
      Math.max(...values) - Math.min(...values);
    for (const { fields, line } of rows()) {
      if (depthIndex !== -1 && numberOf(fields[depthIndex]) < minDepth)
        continue;
      const value =
        levelIndex !== -1
          ? numberOf(fields[levelIndex])
          : numberOf(fields[groundIndex]) + numberOf(fields[depthIndex]);
      // An empty or non-numeric level is a dry cell, like a missing row.
      if (!Number.isFinite(value)) continue;
      const xs = numbers(fields, xIndices);
      const ys = numbers(fields, yIndices);
      const x = mean(xs);
      const y = mean(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(
          `${input.name}:${line}: the coordinates are not numbers.`,
        );
      }
      if (corners) {
        extent.x += spread(xs);
        extent.y += spread(ys);
        extent.rows++;
      }
      xValues.add(x);
      yValues.add(y);
      const t = fileTime ?? timing.secondsOf((fields[timeIndex] ?? "").trim());
      let group = byTime.get(t);
      if (!group) {
        byTime.set(
          t,
          (group = { xs: [], ys: [], levels: [], grounds: [], fields: {} }),
        );
      }
      group.xs.push(x);
      group.ys.push(y);
      group.levels.push(value);
      if (groundIndex !== -1) group.grounds.push(numberOf(fields[groundIndex]));
      fieldNames.forEach((name, f) => {
        // A field first seen on a later row is missing on the earlier ones.
        const list = (group.fields[name] ??= new Array<number>(
          group.xs.length - 1,
        ).fill(NaN));
        list.push(numberOf(fields[fieldIndices[f]]));
      });
      for (const list of Object.values(group.fields)) {
        if (list.length < group.xs.length) list.push(NaN);
      }
    }
  }
  const steps = [...byTime].sort(([a], [b]) => a - b);
  if (!steps.length) throw new Error("No wet cells.");

  // The grid the centers lie on, of the corners' size or the centers' spacing.
  const xList = [...xValues];
  const yList = [...yValues];
  const size = corners
    ? { x: extent.x / extent.rows, y: extent.y / extent.rows }
    : { x: stepOf(xList), y: stepOf(yList) };
  if (!(size.x > 0) || !(size.y > 0)) {
    throw new Error("The corners do not span the cells; give opposite ones.");
  }
  const fit = fitGrid(size.x, size.y, xList, yList, 0.5, CENTER_TOLERANCE);
  if (!fit) {
    throw new Error(
      "The cells do not lie on a regular grid; for scattered points, use a mesh.",
    );
  }
  const { lngStep: dx, latStep: dy, lngOffset, latOffset } = fit;
  const columnOf = (x: number) => Math.round((x - lngOffset) / dx - 0.5);
  const rowOf = (y: number) => Math.round((y - latOffset) / dy - 0.5);
  const [c0, c1] = boundsOf(xList.map(columnOf));
  const [r0, r1] = boundsOf(yList.map(rowOf));
  const width = c1 - c0 + 1;
  const height = r1 - r0 + 1;

  // Each step's rows as source cells, and the ground at them.
  const groundOf = ground
    ? new Float32Array(width * height).fill(NaN)
    : undefined;
  const indices = steps.map(([t, group]) => {
    const cells = Int32Array.from(
      group.xs,
      (x, i) => (rowOf(group.ys[i]) - r0) * width + columnOf(x) - c0,
    );
    const seen = new Set<number>();
    cells.forEach((cell, i) => {
      if (seen.has(cell)) {
        throw new Error(
          `Two rows share the cell at ${group.xs[i]}, ${group.ys[i]} at ${new Date(t * 1000).toISOString()}.`,
        );
      }
      seen.add(cell);
      if (groundOf) groundOf[cell] = group.grounds[i];
    });
    return cells;
  });

  return {
    source: files.length === 1 ? files[0].name : `${files.length} files`,
    width,
    height,
    x0: lngOffset + (c0 + 0.5) * dx,
    y0: latOffset + (r0 + 0.5) * dy,
    dx,
    dy,
    ground: groundOf,
    times: steps.map(([t]) => t),
    step: (k) => {
      const [, group] = steps[k];
      const dense = (values: number[]) => {
        const out = new Float32Array(width * height).fill(NaN);
        indices[k].forEach((cell, i) => (out[cell] = values[i]));
        return out;
      };
      return {
        levels: dense(group.levels),
        fields: Object.fromEntries(
          Object.entries(group.fields).map(([name, list]) => [
            name,
            dense(list),
          ]),
        ),
      };
    },
  };
};

// The cell is the shortest gap between distinct coordinates.
const stepOf = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((v, i) => v - sorted[i]);
  if (!gaps.length) {
    throw new Error("The cells need at least two distinct coordinates.");
  }
  const shortest = gaps.reduce((a, b) => Math.min(a, b));
  const ones = gaps.filter((g) => g < 1.5 * shortest);
  return ones.reduce((a, b) => a + b, 0) / ones.length;
};
