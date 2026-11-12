/**
 * Per-frame fields of a water-surface series on a dense `width` × `height`
 * cell grid, indexed `y * width + x`.
 */

const FAR = 1e20;

/**
 * One pass of the transform along a line of `n` cells of `d`, `stride`
 * apart from `offset`, with the cells `step` apart; `f`, `v` and `z` are
 * scratch space of at least `n`, `n` and `n + 1` entries.
 */
function distancePass(
  d: Float64Array,
  n: number,
  stride: number,
  offset: number,
  step: number,
  f: Float64Array,
  v: Int32Array,
  z: Float64Array,
) {
  const s2 = step * step;
  for (let q = 0; q < n; q++) f[q] = d[offset + q * stride];
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      const p = v[k];
      s = (f[q] + s2 * q * q - (f[p] + s2 * p * p)) / (2 * s2 * (q - p));
      if (s > z[k]) break;
      k--;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[offset + q * stride] = s2 * (q - v[k]) ** 2 + f[v[k]];
  }
}

/**
 * Squared distance (m²) from each cell center to the nearest cell set in
 * `mask`, by the separable exact transform of Felzenszwalb & Huttenlocher
 * with the grid's spacing `dx` × `dy` in meters.
 */
export function squaredDistanceTo(
  mask: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Float64Array {
  const d = new Float64Array(mask.length);
  // A column without a cell set stays as far as it starts, so the first
  // pass skips it.
  const columnSet = new Uint8Array(width);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) columnSet[i % width] = 1;
    else d[i] = FAR;
  }
  const count = Math.max(width, height);
  const f = new Float64Array(count);
  const v = new Int32Array(count);
  const z = new Float64Array(count + 1);
  for (let x = 0; x < width; x++) {
    if (columnSet[x]) distancePass(d, height, width, x, dy, f, v, z);
  }
  for (let y = 0; y < height; y++) {
    distancePass(d, width, 1, y * width, dx, f, v, z);
  }
  return d;
}

/**
 * Signed distance (m) from each cell center to the shoreline of `wet`:
 * negative inside, positive outside, and zero halfway between a wet and a
 * dry cell center.
 */
export function signedDistance(
  wet: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Float32Array {
  const dry = new Uint8Array(wet.length);
  for (let i = 0; i < wet.length; i++) dry[i] = 1 - wet[i];
  const toWet = squaredDistanceTo(wet, width, height, dx, dy);
  const toDry = squaredDistanceTo(dry, width, height, dx, dy);
  const half = Math.min(dx, dy) / 2;
  const out = new Float32Array(wet.length);
  for (let i = 0; i < wet.length; i++) {
    out[i] = wet[i] ? half - Math.sqrt(toDry[i]) : Math.sqrt(toWet[i]) - half;
  }
  return out;
}

/** `mask` grown by one cell in all eight directions. */
export function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (
        let ny = Math.max(y - 1, 0);
        ny <= Math.min(y + 1, height - 1);
        ny++
      ) {
        for (
          let nx = Math.max(x - 1, 0);
          nx <= Math.min(x + 1, width - 1);
          nx++
        ) {
          out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * Fills `levels` (NaN where dry) over `domain`, breadth-first from the wet
 * cells: each new cell takes the mean of its known 4-neighbors, so the
 * surface continues past the shoreline without a step. Cells the water
 * cannot reach through the domain stay NaN.
 */
export function extendLevels(
  levels: Float32Array,
  domain: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const out = Float32Array.from(levels);
  let frontier = new Int32Array(out.length);
  let next = new Int32Array(out.length);
  let count = 0;
  for (let i = 0; i < out.length; i++) {
    if (domain[i] && !Number.isNaN(out[i])) frontier[count++] = i;
  }
  const around = new Int32Array(4);
  const neighbors = (i: number) => {
    const x = i % width;
    const y = (i - x) / width;
    around[0] = x > 0 ? i - 1 : -1;
    around[1] = x < width - 1 ? i + 1 : -1;
    around[2] = y > 0 ? i - width : -1;
    around[3] = y < height - 1 ? i + width : -1;
    return around;
  };
  while (count) {
    let nextCount = 0;
    for (let f = 0; f < count; f++) {
      const i = frontier[f];
      for (let d = 0; d < 4; d++) {
        const n = neighbors(i)[d];
        if (n < 0 || !domain[n] || !Number.isNaN(out[n])) continue;
        let sum = 0;
        let known = 0;
        for (let e = 0; e < 4; e++) {
          const m = neighbors(n)[e];
          if (m >= 0 && !Number.isNaN(out[m])) {
            sum += out[m];
            known++;
          }
        }
        out[n] = sum / known;
        next[nextCount++] = n;
      }
    }
    [frontier, next] = [next, frontier];
    count = nextCount;
  }
  return out;
}

/**
 * The 4-neighbors of each node as node indices, four per node in the order
 * left, right, up, down, or -1 where the neighbor cell is not a node.
 */
export function nodeNeighbors(
  nodes: Uint32Array,
  nodeAt: Int32Array,
  width: number,
  height: number,
): Int32Array {
  const out = new Int32Array(nodes.length * 4).fill(-1);
  for (let n = 0; n < nodes.length; n++) {
    const i = nodes[n];
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) out[n * 4] = nodeAt[i - 1];
    if (x < width - 1) out[n * 4 + 1] = nodeAt[i + 1];
    if (y > 0) out[n * 4 + 2] = nodeAt[i - width];
    if (y < height - 1) out[n * 4 + 3] = nodeAt[i + width];
  }
  return out;
}

/**
 * Fills `values` (NaN where unknown) in place, breadth-first from the known
 * nodes over `neighbors` (see {@link nodeNeighbors}): each new node takes
 * the mean of its known neighbors, so a surface continues past its edge
 * without a step. Nodes unreachable from a known one stay NaN.
 */
export function extendValues(values: Float32Array, neighbors: Int32Array) {
  let frontier = new Int32Array(values.length);
  let next = new Int32Array(values.length);
  let count = 0;
  for (let n = 0; n < values.length; n++) {
    if (!Number.isNaN(values[n])) frontier[count++] = n;
  }
  while (count) {
    let nextCount = 0;
    for (let f = 0; f < count; f++) {
      const n = frontier[f];
      for (let d = 0; d < 4; d++) {
        const m = neighbors[n * 4 + d];
        if (m < 0 || !Number.isNaN(values[m])) continue;
        let sum = 0;
        let known = 0;
        for (let e = 0; e < 4; e++) {
          const o = neighbors[m * 4 + e];
          if (o >= 0 && !Number.isNaN(values[o])) {
            sum += values[o];
            known++;
          }
        }
        values[m] = sum / known;
        next[nextCount++] = m;
      }
    }
    [frontier, next] = [next, frontier];
    count = nextCount;
  }
}

/**
 * Fills `values` (NaN where unknown) in place, breadth-first from the known
 * nodes over `neighbors` (see {@link nodeNeighbors}): each new node copies
 * the known node it was reached from, so a category stays one of the known
 * values. Nodes unreachable from a known one stay NaN.
 */
export function fillNearestValues(values: Float32Array, neighbors: Int32Array) {
  let frontier = new Int32Array(values.length);
  let next = new Int32Array(values.length);
  let count = 0;
  for (let n = 0; n < values.length; n++) {
    if (!Number.isNaN(values[n])) frontier[count++] = n;
  }
  while (count) {
    let nextCount = 0;
    for (let f = 0; f < count; f++) {
      const n = frontier[f];
      const v = values[n];
      for (let d = 0; d < 4; d++) {
        const m = neighbors[n * 4 + d];
        if (m < 0 || !Number.isNaN(values[m])) continue;
        values[m] = v;
        next[nextCount++] = m;
      }
    }
    [frontier, next] = [next, frontier];
    count = nextCount;
  }
}
