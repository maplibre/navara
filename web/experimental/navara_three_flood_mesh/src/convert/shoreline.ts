/**
 * The exact shoreline of outlines that do not follow the cells, in grid-node
 * units: cell `x, y` spans `[x, x + 1]` by `[y, y + 1]`, so its center is at
 * `x + 0.5, y + 0.5`.
 */

type Point = { x: number; y: number };

const BUCKET = 4;
// Distance in grid units within which a vertex lies on an edge.
const ON_EDGE = 1e-6;

/**
 * The boundary of the union of the polygons `rings` outline (all rings of one
 * time step, holes included) as segments `x0, y0, x1, y1`. An edge two
 * polygons share lies inside the union and cancels out. Edges are split at
 * every vertex lying on them first, so a shared stretch cancels even where
 * the two outlines place their vertices differently.
 */
export const unionBoundary = (rings: Point[][]): Float64Array => {
  const buckets = new Map<string, Point[]>();
  for (const p of rings.flat()) {
    const key = `${Math.floor(p.x / BUCKET)},${Math.floor(p.y / BUCKET)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(p);
    else buckets.set(key, [p]);
  }

  const edges = new Map<string, number[]>();
  const toggle = (a: Point, b: Point) => {
    const ka = `${a.x},${a.y}`;
    const kb = `${b.x},${b.y}`;
    if (ka === kb) return;
    const key = ka < kb ? `${ka} ${kb}` : `${kb} ${ka}`;
    if (!edges.delete(key)) edges.set(key, [a.x, a.y, b.x, b.y]);
  };

  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const length = Math.hypot(ex, ey);
      if (length === 0) continue;
      const splits: [number, Point][] = [];
      const bx1 = Math.floor(Math.max(a.x, b.x) / BUCKET);
      const by1 = Math.floor(Math.max(a.y, b.y) / BUCKET);
      for (let bx = Math.floor(Math.min(a.x, b.x) / BUCKET); bx <= bx1; bx++) {
        for (
          let by = Math.floor(Math.min(a.y, b.y) / BUCKET);
          by <= by1;
          by++
        ) {
          for (const p of buckets.get(`${bx},${by}`) ?? []) {
            const t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / length;
            if (t <= ON_EDGE || t >= length - ON_EDGE) continue;
            const off = Math.abs((p.x - a.x) * ey - (p.y - a.y) * ex) / length;
            if (off < ON_EDGE) splits.push([t, p]);
          }
        }
      }
      splits.sort(([s], [t]) => s - t);
      let from = a;
      for (const [, p] of splits) {
        toggle(from, p);
        from = p;
      }
      toggle(from, b);
    }
  }
  return Float64Array.from([...edges.values()].flat());
};

/**
 * Replaces `distance` (meters, negative where `wet`) near the shoreline with
 * the exact distance from each cell center to `segments`, so the shoreline
 * keeps its position between the cell centers instead of falling halfway
 * between a wet and a dry one. Over the second cell out, it blends back into
 * `distance`.
 */
export const refineSignedDistance = (
  distance: Float32Array,
  wet: Uint8Array,
  segments: Float64Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Float32Array => {
  const cell = Math.max(dx, dy);
  const inner = 1.5 * cell;
  const outer = 2.5 * cell;
  // The shoreline lies within a cell of where `distance` puts it.
  const reach = outer + cell;

  const columns = Math.ceil(width / BUCKET);
  const rows = Math.ceil(height / BUCKET);
  const clampColumn = (u: number) =>
    Math.min(Math.max(Math.floor((u - 0.5) / BUCKET), 0), columns - 1);
  const clampRow = (v: number) =>
    Math.min(Math.max(Math.floor((v - 0.5) / BUCKET), 0), rows - 1);
  const buckets = Array.from({ length: columns * rows }, (): number[] => []);
  for (let s = 0; s < segments.length; s += 4) {
    const [x0, y0, x1, y1] = segments.subarray(s, s + 4);
    for (
      let by = clampRow(Math.min(y0, y1));
      by <= clampRow(Math.max(y0, y1));
      by++
    ) {
      for (
        let bx = clampColumn(Math.min(x0, x1));
        bx <= clampColumn(Math.max(x0, x1));
        bx++
      ) {
        buckets[by * columns + bx].push(s);
      }
    }
  }

  const out = Float32Array.from(distance);
  for (let i = 0; i < distance.length; i++) {
    const coarse = Math.abs(distance[i]);
    if (coarse >= outer) continue;
    const u = (i % width) + 0.5;
    const v = Math.floor(i / width) + 0.5;
    let best = Infinity;
    for (
      let by = clampRow(v - reach / dy);
      by <= clampRow(v + reach / dy);
      by++
    ) {
      for (
        let bx = clampColumn(u - reach / dx);
        bx <= clampColumn(u + reach / dx);
        bx++
      ) {
        for (const s of buckets[by * columns + bx]) {
          const ax = (segments[s] - u) * dx;
          const ay = (segments[s + 1] - v) * dy;
          const ex = (segments[s + 2] - segments[s]) * dx;
          const ey = (segments[s + 3] - segments[s + 1]) * dy;
          const t = Math.min(
            Math.max(-(ax * ex + ay * ey) / (ex * ex + ey * ey), 0),
            1,
          );
          best = Math.min(best, (ax + t * ex) ** 2 + (ay + t * ey) ** 2);
        }
      }
    }
    const exact = wet[i] ? -Math.sqrt(best) : Math.sqrt(best);
    const blend = Math.min(Math.max((coarse - inner) / (outer - inner), 0), 1);
    out[i] = exact + (distance[i] - exact) * blend;
  }
  return out;
};
