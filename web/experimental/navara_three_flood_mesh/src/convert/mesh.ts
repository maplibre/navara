import Delaunator from "delaunator";
import earcut from "earcut";

import { cellOffsets, Egm2008Geoid, type VerticalDatum } from "./datum";
import {
  forEachCellIn,
  boundsOf,
  gridOfResolution,
  METERS_PER_DEGREE_LAT,
  METERS_PER_DEGREE_LNG_AT_EQUATOR,
  type Grid,
} from "./grid";
import { readMeshCsv, type MeshCsvOptions } from "./meshCsv";
import { meshSeriesOfNetcdf, type MeshNetcdfOptions } from "./meshNetcdf";
import { withNetcdf } from "./netcdf";
import type { Projection } from "./projection";
import type { PropertyCollector } from "./properties";
import { GROUND_PROPERTY, groundStorage } from "./table";
import { thinTimes } from "./time";
import {
  writeFloodZarr,
  type FloodFrame,
  type FloodStore,
  type FloodTolerance,
  type FloodZarrInfo,
} from "./zarr";

/** How a mesh is sampled and written, whatever its source format. */
export type MeshSamplingOptions = {
  /** The store to write the Zarr group to; see `writeFloodZarr`. */
  output: FloodStore;
  /** The projection of the positions, such as a `PlaneRectangular` zone. */
  projection?: Projection;
  /** Cell size in meters of the grid the mesh is sampled at. */
  resolution: number;
  /** Without faces, the longest triangle edge in meters kept. */
  maxEdge?: number;
  /** Depth in meters below which a node or a cell is dry (0.01). */
  minDepth?: number;
  /** Datum of the heights; orthometric heights over EGM2008 by default. */
  datum?: VerticalDatum;
  /** Seconds the steps are thinned to no closer than. */
  interval?: number;
  /** Keeps only the steps the others do not interpolate to. */
  tolerance?: FloodTolerance;
  /** Per property, the step to store it at; see `FloodSeries.precision`. */
  precision?: Record<string, number>;
  /** Per property, its unit, such as `"m/s"`. */
  units?: Record<string, string>;
  /** Per property, its description. */
  labels?: Record<string, string>;
};

/** CSV files (`inputs`) or a netCDF file (`input`). */
export type MeshOptions = MeshCsvOptions | MeshNetcdfOptions;

export type MeshInfo = FloodZarrInfo & {
  grid: Grid;
  /** Steps read, before keyframes are picked. */
  stepCount: number;
  nodeCount: number;
  /** Triangles sampled, after the faces are split or the nodes triangulated. */
  triangleCount: number;
  /** Triangles dropped for an edge longer than `maxEdge`. */
  droppedTriangles: number;
};

/** The wet nodes (or faces) of one time step, with their values. */
export type MeshStep = {
  index: number[];
  levels: number[];
  /** Per property, its value at each wet node (or face); NaN where missing. */
  properties: Record<string, number[]>;
};

/** A time series of water levels on an unstructured mesh, as read. */
export type MeshSeries = {
  /** Names the source in the group's attributes. */
  source: string;
  /** Node positions as given, projected by `MeshSamplingOptions.projection`. */
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /**
   * The faces as the nodes around each: face `f` is `nodes[starts[f]]` up to
   * `nodes[starts[f + 1]]`. Without them, the nodes are triangulated.
   */
  faces?: { starts: Int32Array; nodes: Int32Array };
  /** Whether the values are at the nodes or at the faces. */
  valuesOn: "nodes" | "faces";
  /** The ground height of each node (or face), NaN where unknown. */
  ground?: ArrayLike<number>;
  /** Seconds since the Unix epoch of each step, increasing. */
  times: ArrayLike<number>;
  /** The values of step `k`. */
  step: (k: number) => MeshStep | Promise<MeshStep>;
  /** The collector the steps' properties came through. */
  properties?: PropertyCollector;
};

/**
 * Converts a time series of water levels on an unstructured mesh into the
 * Zarr group `loadTimeSeriesFlood` reads, by sampling it on a grid of
 * `resolution`-meter cells. Values at the nodes are interpolated linearly
 * over the triangles, and where some nodes of a triangle are dry, the depth
 * is, so the water thins out towards them.
 */
export const convertMesh = async (options: MeshOptions): Promise<MeshInfo> =>
  "input" in options
    ? withNetcdf(options.input, (file) =>
        sampleMesh(meshSeriesOfNetcdf(file, options), options),
      )
    : sampleMesh(await readMeshCsv(options), options);

/** Samples `series` on the grid and writes it to `options.output`. */
export const sampleMesh = async (
  series: MeshSeries,
  options: MeshSamplingOptions,
): Promise<MeshInfo> => {
  const {
    output,
    projection,
    resolution,
    maxEdge,
    minDepth = 0.01,
    datum = new Egm2008Geoid(),
    interval = 0,
    tolerance,
    precision,
    units,
    labels,
  } = options;
  const { faces, valuesOn, ground: grounds } = series;
  if (valuesOn === "faces" && !faces) {
    throw new Error("Values on the faces need the faces.");
  }
  if (!faces && maxEdge === undefined) {
    throw new Error("Without faces, give the maxEdge to triangulate by.");
  }

  const nodeCount = series.x.length;
  if (nodeCount < 3) throw new Error("The mesh needs at least three nodes.");
  const lngs = new Float64Array(nodeCount);
  const lats = new Float64Array(nodeCount);
  for (let n = 0; n < nodeCount; n++) {
    const [x, y] = [series.x[n], series.y[n]];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`${series.source}: node ${n} has no position.`);
    }
    if (!projection && (Math.abs(x) > 180 || Math.abs(y) > 90)) {
      throw new Error(
        `${series.source}: node ${n} at ${x}, ${y} is not in degrees; give the projection.`,
      );
    }
    [lngs[n], lats[n]] = projection ? projection.toGeographic(x, y) : [x, y];
  }
  const [south, north] = boundsOf(lats);
  const latMid = (south + north) / 2;
  const kx =
    METERS_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((latMid * Math.PI) / 180);
  const ky = METERS_PER_DEGREE_LAT;

  // Triangles as node indices, three each, with the face each lies in.
  const triangles: number[] = [];
  const triangleFaces: number[] = [];
  let droppedTriangles = 0;
  if (faces) {
    const { starts, nodes } = faces;
    for (let f = 0; f + 1 < starts.length; f++) {
      const ring = Array.from(nodes.subarray(starts[f], starts[f + 1]));
      if (ring.length < 3) {
        throw new Error(`${series.source}: face ${f} has fewer than 3 nodes.`);
      }
      const split =
        ring.length === 3
          ? [0, 1, 2]
          : earcut(ring.flatMap((n) => [lngs[n] * kx, lats[n] * ky]));
      for (const k of split) triangles.push(ring[k]);
      for (let k = 0; k < split.length; k += 3) triangleFaces.push(f);
    }
  } else {
    const coords = new Float64Array(nodeCount * 2);
    for (let n = 0; n < nodeCount; n++) {
      coords[2 * n] = lngs[n] * kx;
      coords[2 * n + 1] = lats[n] * ky;
    }
    const delaunay = new Delaunator(coords);
    const longest = (maxEdge ?? Infinity) ** 2;
    const edge = (a: number, b: number) =>
      (coords[2 * a] - coords[2 * b]) ** 2 +
      (coords[2 * a + 1] - coords[2 * b + 1]) ** 2;
    const t = delaunay.triangles;
    for (let k = 0; k < t.length; k += 3) {
      if (
        edge(t[k], t[k + 1]) > longest ||
        edge(t[k + 1], t[k + 2]) > longest ||
        edge(t[k + 2], t[k]) > longest
      ) {
        droppedTriangles++;
        continue;
      }
      triangles.push(t[k], t[k + 1], t[k + 2]);
    }
  }
  const triangleCount = triangles.length / 3;
  if (!triangleCount) throw new Error("No triangles to sample.");

  // Each grid cell whose center a triangle covers, the first to claim it,
  // with the weights of the triangle's nodes there.
  const grid = gridOfResolution(resolution, latMid);
  const u = Array.from(lngs, (lng) => (lng - grid.lngOffset) / grid.lngStep);
  const v = Array.from(lats, (lat) => (lat - grid.latOffset) / grid.latStep);
  const [uMin, uMax] = boundsOf(u);
  const [vMin, vMax] = boundsOf(v);
  const x0 = Math.floor(uMin);
  const y0 = Math.floor(vMin);
  const span = Math.ceil(uMax) - x0 + 1;
  const rows = Math.ceil(vMax) - y0 + 1;
  const claimed = new Uint8Array(span * rows);
  const cellX: number[] = [];
  const cellY: number[] = [];
  const cellTriangle: number[] = [];
  const cellWeights: number[] = [];
  for (let k = 0; k < triangleCount; k++) {
    const [a, b, c] = [0, 1, 2].map((i) => triangles[3 * k + i]);
    forEachCellIn(
      { x: u[a], y: v[a] },
      { x: u[b], y: v[b] },
      { x: u[c], y: v[c] },
      (x, y, wa, wb) => {
        const slot = (y - y0) * span + (x - x0);
        if (claimed[slot]) return;
        claimed[slot] = 1;
        cellX.push(x);
        cellY.push(y);
        cellTriangle.push(k);
        cellWeights.push(wa, wb, 1 - wa - wb);
      },
    );
  }
  const cellCount = cellX.length;

  const groundOf = (e: number) => grounds?.[e] ?? NaN;
  // The ground at each cell, where every node of its triangle (or its face)
  // has one.
  const cellGround = new Float64Array(cellCount).fill(NaN);
  for (let i = 0; i < cellCount; i++) {
    const k = cellTriangle[i];
    if (valuesOn === "faces") {
      cellGround[i] = groundOf(triangleFaces[k]);
      continue;
    }
    let g = 0;
    for (let j = 0; j < 3; j++) {
      g += cellWeights[3 * i + j] * groundOf(triangles[3 * k + j]);
    }
    cellGround[i] = g;
  }

  const elementCount =
    valuesOn === "faces" && faces ? faces.starts.length - 1 : nodeCount;
  const levelOf = new Float64Array(elementCount).fill(NaN);
  const propertyOf = new Map<string, Float64Array>();
  /**
   * The level of cell `i` in the frame in `levelOf`, with the wet nodes (or
   * the face) its properties are weighted from, or `undefined` while dry.
   */
  const sampleCell = (i: number) => {
    const k = cellTriangle[i];
    if (valuesOn === "faces") {
      const f = triangleFaces[k];
      const level = levelOf[f];
      // NaN, without the ground, compares as wet.
      if (Number.isNaN(level) || level - cellGround[i] < minDepth) return;
      return { level, from: [f], weights: [1] };
    }
    const ns = [0, 1, 2].map((j) => triangles[3 * k + j]);
    const ws = [0, 1, 2].map((j) => cellWeights[3 * i + j]);
    const wet = ns.map((n) => !Number.isNaN(levelOf[n]));
    if (!wet.some(Boolean)) return;
    const from = ns.filter((_, j) => wet[j]);
    const weights = ws.filter((_, j) => wet[j]);
    if (!Number.isNaN(cellGround[i])) {
      // The depth, 0 at the dry nodes, thins out towards them.
      let depth = 0;
      from.forEach((n, j) => {
        depth += weights[j] * Math.max(levelOf[n] - groundOf(n), 0);
      });
      if (depth < minDepth) return;
      return { level: cellGround[i] + depth, from, weights };
    }
    // Without the ground, the cell is wet where the wet nodes weigh more, at
    // their level.
    const weight = weights.reduce((a, b) => a + b, 0);
    if (weight < 0.5) return;
    const sum = from.reduce((a, n, j) => a + weights[j] * levelOf[n], 0);
    return { level: sum / weight, from, weights };
  };

  const kept = thinTimes(series.times, interval);
  const frames: FloodFrame[] = [];
  // Per frame, its wet cells, with their levels and ground in the datum.
  const frameCells: { cells: number[]; levels: number[]; grounds: number[] }[] =
    [];
  for (const k of kept) {
    const step = await series.step(k);
    const names = Object.keys(step.properties);
    for (const name of names) {
      if (!propertyOf.has(name)) {
        propertyOf.set(name, new Float64Array(elementCount).fill(NaN));
      }
    }
    for (let r = 0; r < step.index.length; r++) {
      const e = step.index[r];
      levelOf[e] = step.levels[r];
      for (const name of names) {
        (propertyOf.get(name) as Float64Array)[e] = step.properties[name][r];
      }
    }
    const cells: number[] = [];
    const levels: number[] = [];
    const cellProperties = new Map(names.map((n) => [n, [] as number[]]));
    const cellGrounds: number[] = [];
    for (let i = 0; i < cellCount; i++) {
      const sample = sampleCell(i);
      if (!sample) continue;
      cells.push(i);
      levels.push(sample.level);
      cellGrounds.push(cellGround[i]);
      for (const [name, list] of cellProperties) {
        const values = propertyOf.get(name) as Float64Array;
        let sum = 0;
        let weight = 0;
        sample.from.forEach((e, j) => {
          const p = values[e];
          if (Number.isNaN(p)) return;
          sum += sample.weights[j] * p;
          weight += sample.weights[j];
        });
        list.push(weight > 0 ? sum / weight : NaN);
      }
    }
    for (const e of step.index) {
      levelOf[e] = NaN;
      for (const values of propertyOf.values()) values[e] = NaN;
    }
    frames.push({
      x: Int32Array.from(cells, (i) => cellX[i]),
      y: Int32Array.from(cells, (i) => cellY[i]),
      level: new Float32Array(0),
      properties: Object.fromEntries(
        [...cellProperties].map(([name, list]) => [
          name,
          Float32Array.from(list),
        ]),
      ),
    });
    frameCells.push({ cells, levels, grounds: cellGrounds });
  }
  if (!frames.length) throw new Error("No steps.");

  // The datum at the center of every cell ever wet, sampled at once.
  const offsets = await cellOffsets(
    datum,
    grid,
    cellX,
    cellY,
    frameCells.flatMap(({ cells }) => cells),
  );
  const frameGrounds = frameCells.map(({ cells, levels, grounds }, f) => {
    frames[f].level = Float32Array.from(
      levels,
      (v, r) => v + offsets[cells[r]],
    );
    return Float32Array.from(grounds, (v, r) => v + offsets[cells[r]]);
  });

  // Known once every step is read: the properties with a number, and
  // whether the ground is stored.
  series.properties?.report();
  const written = series.properties?.written ?? [];
  const storage = groundStorage(grounds && GROUND_PROPERTY, written, {
    precision,
    units,
    labels,
  });
  frames.forEach((frame, f) => {
    const all = frame.properties ?? {};
    const n = frame.level.length;
    frame.properties = Object.fromEntries([
      ...written.map((name) => [
        name,
        all[name] ?? new Float32Array(n).fill(NaN),
      ]),
      ...(storage.stores ? [[GROUND_PROPERTY, frameGrounds[f]]] : []),
    ]);
  });

  const info = await writeFloodZarr(output, {
    grid,
    times: Float64Array.from(kept, (k) => series.times[k]),
    frames,
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
    stepCount: kept.length,
    nodeCount,
    triangleCount,
    droppedTriangles,
  };
};
