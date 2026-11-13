/**
 * Samples a time-series flood simulation (CZML) onto a regular grid. Each
 * time step outlines its wet area with polygons whose vertices carry the
 * water-surface height; a cell is wet where its center lies inside one.
 *
 * Outlines that follow a grid are the outlines of the simulation cells: that
 * grid is detected and reused, so the cells come back exactly. Other
 * outlines are sampled at a given resolution.
 */
import earcut from "earcut";

import { fitGrid, forEachCellIn, gridOfResolution, type Grid } from "./grid";
import { unwrapCzmlProperties, type PropertyCollector } from "./properties";
import { unionBoundary } from "./shoreline";

// A vertex further than this, in cells, from a grid node is off the grid.
const NODE_TOLERANCE = 0.05;

type CzmlPacket = {
  availability?: string;
  properties?: Record<string, unknown>;
  polygon?: {
    positions: { cartographicDegrees: number[] };
    holes?: { cartographicDegrees: number[][] };
  };
};

type Ring = { x: number; y: number; h: number }[];

const ringsOf = (packet: CzmlPacket) =>
  packet.polygon
    ? [
        packet.polygon.positions.cartographicDegrees,
        ...(packet.polygon.holes?.cartographicDegrees ?? []),
      ]
    : [];

/**
 * The grid the outlines follow, or `undefined` when an edge runs off the grid
 * lines or a vertex off the grid nodes. Axis-aligned edges span whole cells,
 * so the shortest one is a cell.
 */
export const detectGrid = (packets: CzmlPacket[]): Grid | undefined => {
  const lngEdges: number[] = [];
  const latEdges: number[] = [];
  const lngs: number[] = [];
  const lats: number[] = [];
  for (const flat of packets.flatMap(ringsOf)) {
    for (let i = 0; i + 5 < flat.length; i += 3) {
      const dx = Math.abs(flat[i + 3] - flat[i]);
      const dy = Math.abs(flat[i + 4] - flat[i + 1]);
      if (dx === 0 && dy === 0) continue;
      if (dx > 100 * dy) lngEdges.push(dx);
      else if (dy > 100 * dx) latEdges.push(dy);
      else return undefined;
      lngs.push(flat[i]);
      lats.push(flat[i + 1]);
    }
  }
  if (!lngEdges.length || !latEdges.length) return undefined;
  const cellOf = (edges: number[]) => {
    const shortest = edges.reduce((a, b) => Math.min(a, b));
    const ones = edges.filter((e) => e < 1.5 * shortest);
    return ones.reduce((a, b) => a + b, 0) / ones.length;
  };
  return fitGrid(
    cellOf(lngEdges),
    cellOf(latEdges),
    lngs,
    lats,
    0,
    NODE_TOLERANCE,
  );
};

// A grid of `meters`-sized cells at the outlines' mean latitude.
const gridOfOutlines = (packets: CzmlPacket[], meters: number): Grid => {
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const flat of packets.flatMap(ringsOf)) {
    for (let i = 1; i < flat.length; i += 3) {
      minLat = Math.min(minLat, flat[i]);
      maxLat = Math.max(maxLat, flat[i]);
    }
  }
  return gridOfResolution(meters, (minLat + maxLat) / 2);
};

// Ring vertices in grid-node units; with `snap`, rounded onto the nodes.
const toRing = (flat: number[], grid: Grid, snap: boolean): Ring => {
  const ring: Ring = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const x = (flat[i] - grid.lngOffset) / grid.lngStep;
    const y = (flat[i + 1] - grid.latOffset) / grid.latStep;
    ring.push({
      x: snap ? Math.round(x) : x,
      y: snap ? Math.round(y) : y,
      h: flat[i + 2],
    });
  }
  return ring;
};

// Cells whose center lies inside the polygon, by even-odd scanline over all
// rings (so holes are excluded naturally). Cells are keyed `x,y`.
const fillCells = (rings: Ring[], minY: number, maxY: number) => {
  const inside: string[] = [];
  for (let y = Math.ceil(minY - 0.5); y + 0.5 <= maxY; y++) {
    const cy = y + 0.5;
    const crossings: number[] = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (a.y > cy !== b.y > cy) {
          crossings.push(((b.x - a.x) * (cy - a.y)) / (b.y - a.y) + a.x);
        }
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      for (
        let x = Math.ceil(crossings[k] - 0.5);
        x + 0.5 < crossings[k + 1];
        x++
      ) {
        inside.push(`${x},${y}`);
      }
    }
  }
  return inside;
};

type Vertex = { x: number; y: number; h: number };

/**
 * Sets the linearly interpolated height of every cell in `cells` whose center
 * lies in the triangle and has no height yet. Neighboring triangles agree on
 * their shared edge, so the first one to claim a cell is as good as any.
 */
const interpolateTriangle = (
  a: Vertex,
  b: Vertex,
  c: Vertex,
  cells: Map<string, number | undefined>,
) =>
  forEachCellIn(a, b, c, (x, y, wa, wb) => {
    const key = `${x},${y}`;
    if (!cells.has(key) || cells.get(key) !== undefined) return;
    cells.set(key, wa * a.h + wb * b.h + (1 - wa - wb) * c.h);
  });

/**
 * Step availability intervals (sorted) and, per cell `x,y`, its water-surface
 * height (ellipsoidal, meters) per step — `undefined` while dry. `uncovered`
 * counts the cell-steps the triangulation missed and the neighbor fill took.
 * With a `collector`, `cellProperties` holds per property and cell its value
 * per step, taken from the packet's `properties` of the polygon covering it.
 *
 * Without `resolution`, the outlines must follow a grid, which becomes the
 * cells. With it, the cells are `resolution` meters wide, and `shorelines`
 * holds each step's shoreline in grid-node units for the exact distance to
 * it, since the cells no longer resolve it.
 */
export const readFloodCells = (
  packets: CzmlPacket[],
  resolution?: number,
  collector?: PropertyCollector,
) => {
  let grid: Grid;
  if (resolution === undefined) {
    const detected = detectGrid(packets);
    if (!detected) {
      throw new Error(
        "The outlines do not follow a grid; pass a resolution to sample them.",
      );
    }
    grid = detected;
  } else {
    grid = gridOfOutlines(packets, resolution);
  }
  const snap = resolution === undefined;
  const steps = [
    ...new Set(
      packets.flatMap((p) =>
        p.polygon && p.availability ? [p.availability] : [],
      ),
    ),
  ].sort();
  const stepIndex = new Map(steps.map((s, i) => [s, i]));

  const cells = new Map<string, (number | undefined)[]>();
  const cellProperties = new Map<string, Map<string, (number | undefined)[]>>();
  const stepRings = steps.map((): Ring[] => []);
  let uncovered = 0;

  for (const packet of packets) {
    if (!packet.polygon || !packet.availability) continue;
    const step = stepIndex.get(packet.availability) ?? 0;
    const values = collector?.collect(unwrapCzmlProperties(packet.properties));
    const rings = [
      toRing(packet.polygon.positions.cartographicDegrees, grid, snap),
      ...(packet.polygon.holes?.cartographicDegrees ?? [])
        .filter((r) => r.length >= 9)
        .map((r) => toRing(r, grid, snap)),
    ];
    if (!snap) stepRings[step].push(...rings);

    // Heights are given only at ring vertices (grid nodes on the boundary).
    // Like a viewer drawing the polygon with per-position heights, triangulate
    // it and interpolate the vertex heights linearly at each cell center.
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ring of rings) {
      for (const { y } of ring) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const local = new Map<string, number | undefined>(
      fillCells(rings, minY, maxY).map((key) => [key, undefined]),
    );
    // The rings without their closing vertex, end to end, with where each
    // hole starts.
    const vertices: Vertex[] = [];
    const holeIndices: number[] = [];
    rings.forEach((ring, r) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      const open =
        ring.length > 1 && first.x === last.x && first.y === last.y
          ? ring.slice(0, -1)
          : ring;
      if (r > 0) holeIndices.push(vertices.length);
      vertices.push(...open);
    });
    const faces = earcut(
      vertices.flatMap(({ x, y }) => [x, y]),
      holeIndices,
    );
    for (let i = 0; i < faces.length; i += 3) {
      interpolateTriangle(
        vertices[faces[i]],
        vertices[faces[i + 1]],
        vertices[faces[i + 2]],
        local,
      );
    }

    // Cells no triangle covers (degenerate rings): fill them from known
    // neighbors, breadth-first.
    uncovered += [...local.values()].filter((h) => h === undefined).length;
    let frontier = [...local].filter(([, h]) => h !== undefined);
    while (frontier.length) {
      const next: [string, number][] = [];
      for (const [key] of frontier) {
        const [x, y] = key.split(",").map(Number);
        for (const n of [
          `${x - 1},${y}`,
          `${x + 1},${y}`,
          `${x},${y - 1}`,
          `${x},${y + 1}`,
        ]) {
          if (!local.has(n) || local.get(n) !== undefined) continue;
          const [nx, ny] = n.split(",").map(Number);
          const known = [
            local.get(`${nx - 1},${ny}`),
            local.get(`${nx + 1},${ny}`),
            local.get(`${nx},${ny - 1}`),
            local.get(`${nx},${ny + 1}`),
          ].filter((h) => h !== undefined);
          const h = known.reduce((a, b) => a + b, 0) / known.length;
          local.set(n, h);
          next.push([n, h]);
        }
      }
      frontier = next;
    }

    for (const [key, h] of local) {
      if (h === undefined) continue;
      let series = cells.get(key);
      if (!series) {
        series = new Array<number | undefined>(steps.length);
        cells.set(key, series);
      }
      series[step] = h;
      for (const [name, value] of Object.entries(values ?? {})) {
        if (Number.isNaN(value)) continue;
        let byCell = cellProperties.get(name);
        if (!byCell) cellProperties.set(name, (byCell = new Map()));
        let list = byCell.get(key);
        if (!list) byCell.set(key, (list = new Array(steps.length)));
        list[step] = value;
      }
    }
  }
  collector?.report();

  const shorelines = snap ? undefined : stepRings.map(unionBoundary);
  return { grid, steps, cells, cellProperties, uncovered, shorelines };
};

/**
 * Each step's time as an ISO string without milliseconds: the `start` or the
 * `end` of its availability interval. Exports differ in which of the two the
 * step shows.
 */
export const stepTimes = (steps: string[], at: "start" | "end") =>
  steps.map((s) => s.split("/")[at === "start" ? 0 : 1].replace(".000Z", "Z"));
