import { parseUtc } from "../utc";

import { readFloodCells, stepTimes } from "./czml";
import { Ellipsoid, type VerticalDatum } from "./datum";
import { boundsOf } from "./grid";
import { decodeText, readInput, type Input } from "./input";
import { PropertyCollector, type PropertiesOption } from "./properties";
import { sampleRasters, type RastersInfo } from "./rasters";
import type { Terrain } from "./terrain";
import type { FloodStore, FloodTolerance } from "./zarr";

export type PolygonsOptions = {
  /**
   * A CZML file whose packets outline each time step's wet area with
   * polygons. Their vertices carry the water-surface height, above the WGS84
   * ellipsoid unless `datum` says otherwise. The polygons of one time step
   * must not overlap.
   */
  input: Input;
  /** Datum of the heights; the WGS84 ellipsoid by default, as in CZML. */
  datum?: VerticalDatum;
  /**
   * The terrain to sample the ground height from, which the outlines do not
   * carry, at the center of each cell: it is stored as the `ground` property,
   * so `loadTimeSeriesFlood` derives the depth. A `raster-dem` source or a
   * `TerrainSampler`.
   */
  terrain?: Terrain;
  /** The store to write the Zarr group to; see `writeFloodZarr`. */
  output: FloodStore;
  /**
   * Cell size in meters to sample the outlines at. Outlines that follow a
   * grid are taken as the simulation cells without it; others need it.
   */
  resolution?: number;
  /** Which end of its availability interval times a step. */
  time?: "start" | "end";
  /** Seconds the steps are thinned to no closer than. */
  interval?: number;
  /** Keeps only the steps the others do not interpolate to. */
  tolerance?: FloodTolerance;
  /**
   * Properties stored with the cells of each polygon: names to take from
   * the packet's `properties`, or a callback given them.
   */
  properties?: PropertiesOption;
  /** Per property, the step to store it at; see `FloodSeries.precision`. */
  precision?: Record<string, number>;
  /** Per property, its unit, such as `"m/s"`. */
  units?: Record<string, string>;
  /** Per property, its description. */
  labels?: Record<string, string>;
};

export type PolygonsInfo = RastersInfo & {
  /** Cell-steps inside an outline but outside its triangulation. */
  uncovered: number;
};

/**
 * Converts a time-series flood simulation outlined by polygons (CZML) into
 * the Zarr group `loadTimeSeriesFlood` reads. Cells inside an outline take
 * its heights, triangulated and interpolated linearly.
 */
export const convertPolygons = async ({
  input,
  output,
  datum = new Ellipsoid(),
  terrain,
  resolution,
  time = "start",
  interval,
  tolerance,
  properties,
  precision,
  units,
  labels,
}: PolygonsOptions): Promise<PolygonsInfo> => {
  const collector = properties && new PropertyCollector(properties);
  const { grid, steps, cells, cellProperties, uncovered, shorelines } =
    readFloodCells(
      JSON.parse(decodeText(await readInput(input))),
      resolution,
      collector,
    );

  const times = Float64Array.from(
    stepTimes(steps, time),
    (s) => parseUtc(s) / 1000,
  );
  if (times.some((t, k) => k > 0 && t <= times[k - 1])) {
    throw new Error(
      `Step times taken at the interval ${time} do not increase; the ` +
        `intervals may overlap, so try timing steps by the other end.`,
    );
  }

  // The outlines' cells, as source cells on the grid they were filled on.
  const positions = [...cells.keys()].map((key) => key.split(",").map(Number));
  const [c0, c1] = boundsOf(positions.map(([x]) => x));
  const [r0, r1] = boundsOf(positions.map(([, y]) => y));
  const width = c1 - c0 + 1;
  const height = r1 - r0 + 1;
  const indexOf = new Map(
    [...cells.keys()].map((key, i) => {
      const [x, y] = positions[i];
      return [key, (y - r0) * width + x - c0];
    }),
  );
  /** The values of step `k` at the source cells; NaN where none. */
  const dense = (byCell: Map<string, (number | undefined)[]>, k: number) => {
    const values = new Float32Array(width * height).fill(NaN);
    for (const [key, series] of byCell) {
      const value = series[k];
      if (value !== undefined) values[indexOf.get(key) as number] = value;
    }
    return values;
  };

  const info = await sampleRasters(
    {
      source: input.name,
      width,
      height,
      x0: grid.lngOffset + (c0 + 0.5) * grid.lngStep,
      y0: grid.latOffset + (r0 + 0.5) * grid.latStep,
      dx: grid.lngStep,
      dy: grid.latStep,
      times,
      shorelines: shorelines?.map((segments) =>
        segments.map((v, i) => v - (i % 2 ? r0 : c0)),
      ),
      step: (k) => ({
        levels: dense(cells, k),
        fields: Object.fromEntries(
          [...cellProperties].map(([name, byCell]) => [name, dense(byCell, k)]),
        ),
      }),
    },
    {
      output,
      datum,
      terrain,
      interval,
      tolerance,
      properties: collector?.written,
      precision,
      units,
      labels,
    },
  );
  return { ...info, uncovered };
};
