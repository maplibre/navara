/**
 * A grid in degrees: cell `x, y` spans `[x, x + 1] * lngStep + lngOffset` by
 * `[y, y + 1] * latStep + latOffset`.
 */
export type Grid = {
  lngStep: number;
  latStep: number;
  lngOffset: number;
  latOffset: number;
  /** `N` when the cell is the Japanese standard mesh (45″ × 30″) / `N`. */
  meshDivision?: number;
};

/**
 * The least and greatest of the values, which can be more than `Math.min`
 * takes as spread arguments.
 */
export const boundsOf = (values: Iterable<number>): [number, number] => {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return [min, max];
};

export const METERS_PER_DEGREE_LAT = 110_950;
export const METERS_PER_DEGREE_LNG_AT_EQUATOR = 111_320;

const MESH_DIVISIONS = [
  1, 2, 4, 5, 8, 10, 16, 20, 25, 40, 50, 80, 100, 200, 400,
];
// Standard (third) mesh cell: 45″ lng by 30″ lat.
const MESH_LNG = 1 / 80;
const MESH_LAT = 1 / 120;

/**
 * The grid of cells `lngStep` × `latStep` whose corners (`at` 0) or centers
 * (`at` 0.5) are at `lngs`, `lats`, or `undefined` when one of them is
 * further than `tolerance` cells off. A step within 0.1 % of a standard mesh
 * division snaps to it. The offset is the circular mean of the positions
 * within a cell, zero when the grid shares the mesh origin.
 */
export const fitGrid = (
  lngStep: number,
  latStep: number,
  lngs: readonly number[],
  lats: readonly number[],
  at: number,
  tolerance: number,
): Grid | undefined => {
  const meshDivision = MESH_DIVISIONS.find(
    (n) =>
      Math.abs(lngStep * n - MESH_LNG) < 1e-3 * MESH_LNG &&
      Math.abs(latStep * n - MESH_LAT) < 1e-3 * MESH_LAT,
  );
  if (meshDivision) {
    lngStep = MESH_LNG / meshDivision;
    latStep = MESH_LAT / meshDivision;
  }
  const offsetOf = (values: readonly number[], step: number) => {
    let sin = 0;
    let cos = 0;
    for (const v of values) {
      const a = ((v / step - at) % 1) * 2 * Math.PI;
      sin += Math.sin(a);
      cos += Math.cos(a);
    }
    const fraction = Math.atan2(sin, cos) / (2 * Math.PI);
    return Math.abs(fraction) < 0.01 ? 0 : fraction * step;
  };
  const lngOffset = offsetOf(lngs, lngStep);
  const latOffset = offsetOf(lats, latStep);
  const off = (values: readonly number[], step: number, offset: number) =>
    values.some((v) => {
      const u = (v - offset) / step - at;
      return Math.abs(u - Math.round(u)) > tolerance;
    });
  if (off(lngs, lngStep, lngOffset) || off(lats, latStep, latOffset)) {
    return undefined;
  }
  return { lngStep, latStep, lngOffset, latOffset, meshDivision };
};

/** A grid of `meters`-sized cells at latitude `latMid`. */
export const gridOfResolution = (meters: number, latMid: number): Grid => {
  if (!(meters > 0 && Number.isFinite(meters))) {
    throw new Error(
      `The resolution must be a positive number of meters, not ${meters}.`,
    );
  }
  return {
    lngStep:
      meters /
      (METERS_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((latMid * Math.PI) / 180)),
    latStep: meters / METERS_PER_DEGREE_LAT,
    lngOffset: 0,
    latOffset: 0,
  };
};

type Point = { x: number; y: number };

/**
 * Calls `visit` for each cell whose center lies in the triangle `a b c`,
 * given in grid-node units, with the barycentric weights of `a` and `b` at
 * that center. A degenerate triangle covers no cell.
 */
export const forEachCellIn = (
  a: Point,
  b: Point,
  c: Point,
  visit: (x: number, y: number, wa: number, wb: number) => void,
) => {
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (det === 0) return;
  const edges = [
    [a, b],
    [b, c],
    [c, a],
  ];
  const y0 = Math.ceil(Math.min(a.y, b.y, c.y) - 0.5);
  const y1 = Math.floor(Math.max(a.y, b.y, c.y) - 0.5);
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs = edges.flatMap(([p, q]) =>
      p.y !== q.y && (p.y - cy) * (q.y - cy) <= 0
        ? [p.x + ((cy - p.y) * (q.x - p.x)) / (q.y - p.y)]
        : [],
    );
    if (xs.length < 2) continue;
    const x0 = Math.ceil(Math.min(...xs) - 0.5);
    const x1 = Math.floor(Math.max(...xs) - 0.5);
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5;
      const wa = ((b.y - c.y) * (cx - c.x) + (c.x - b.x) * (cy - c.y)) / det;
      const wb = ((c.y - a.y) * (cx - c.x) + (a.x - c.x) * (cy - c.y)) / det;
      visit(x, y, wa, wb);
    }
  }
};

/** Mesh division or sampling of `grid`, for logs. */
export const describeGrid = (grid: Grid) =>
  grid.meshDivision
    ? `standard mesh / ${grid.meshDivision}`
    : "not a standard mesh division";
