import { MathUtils } from "three";

/**
 * Packing for the Rust `lineLabelPlace` kernel.
 *
 * Kept separate from the mesh, and free of three.js and WASM, so the layout
 * contract with `crates/navara_wasm_api/src/line_label.rs` is unit-testable on
 * its own — the same split `declutter/kernel.ts` makes for `declutterPlace`.
 */

/** `f64` values per label in the kernel's packed input. */
export const LINE_LABEL_STRIDE = 23;

/** `f64` values per label in the kernel's packed output: flip, rejected, the
 *  rotated box as minX/maxX/minY/maxY, then metres per pixel at the anchor. */
export const LINE_LABEL_RESULT_STRIDE = 7;

/** `f64` values per label in the `lineLabelFit` pre-pass's packed input. */
export const LINE_LABEL_FIT_STRIDE = 11;

/** Scalars the engine sends per anchor alongside its path samples. */
export const PATH_META_STRIDE = 2;

/** Scalars per anchor in the engine's scale-band buffer: the `(min, max]`
 *  ground metres per screen pixel over which it is shown. Must match
 *  `SCALE_BAND_STRIDE` in `crates/navara_parser/src/line_placement.rs`. */
export const SCALE_BAND_STRIDE = 2;

/**
 * How much line a label may occupy either side of its anchor, in metres.
 *
 * The smaller of two limits, and both matter:
 *
 * - the **real line** left before its end, which is what "the label would
 *   overrun its road" means; and
 * - the **span the engine actually sampled** for this anchor, which is
 *   `spacing` either side — `line_placement.rs` samples `PATH_SPAN_SPACINGS * spacing`
 *   of line across `PATH_SAMPLES` points.
 *
 * Only the first used to be checked. A label longer than the sampled span
 * still draws: the vertex shader clamps its path lookup to the last sample, so
 * everything past the span piles onto that one point and the far words land on
 * top of the near ones. It shows up as soon as `spacing` is small enough that
 * the span is shorter than a label — on straight roads as much as curved ones,
 * which is what distinguishes it from a curvature problem.
 *
 * Rejecting instead is also the right cartography: a label longer than the gap
 * to its own next repeat would collide with it anyway.
 */
function usableHalfExtentMeters(path: LinePath, instanceIndex: number): number {
  const meta = path.meta;
  const o = instanceIndex * PATH_META_STRIDE;
  const stepMeters = meta?.[o] ?? 0;
  const realLine = meta?.[o + 1] ?? 0;
  // Mirrors `halfSpan` in sdfText.vert.glsl; the two must move together.
  const sampledSpan = 0.5 * (path.stride / 2 - 1) * stepMeters;
  return Math.min(realLine, sampledSpan);
}

/** Bounds of the anchor's scale band; a path always comes with one. */
function scaleBandMin(path: LinePath, instanceIndex: number): number {
  return path.scaleBands?.[instanceIndex * SCALE_BAND_STRIDE] ?? 0;
}

function scaleBandMax(path: LinePath, instanceIndex: number): number {
  return path.scaleBands?.[instanceIndex * SCALE_BAND_STRIDE + 1] ?? Infinity;
}

/** The subset of a label record this packing reads. */
export type PackableLabel = {
  slot: number;
  instanceIndex: number;
  anchor: Float64Array;
  addHeight: number;
  widthEm: number;
  heightEm: number;
  minYEm: number;
  maxYEm: number;
  maxWordHalfEm: number;
  fontSize: number;
};

/** The resampled line each anchor sits on. */
export type LinePath = {
  /** East/north metre offsets from each anchor, `stride` floats per anchor. */
  samples: Float32Array<ArrayBufferLike>;
  /** Floats per anchor — twice the sample count. */
  stride: number;
  /** Per-anchor `(metres between samples, metres of real line either side)`. */
  meta: Float32Array<ArrayBufferLike> | null;
  /** Per-anchor tangent bearing in degrees clockwise from north. */
  bearings: Float32Array<ArrayBufferLike> | null;
  /** Per-anchor scale band, {@link SCALE_BAND_STRIDE} floats each. */
  scaleBands: Float32Array<ArrayBufferLike> | null;
};

export type LinePlacementOptions = {
  sizeInMeters: boolean;
  maxAngleDeg: number;
  keepUpright: boolean;
  /** The text block's anchor point, already clamped to [-0.5, 0.5]. */
  center: readonly [number, number];
  /** Perpendicular offset from the line, in the font size's units. */
  lineOffset: number;
  /** Whether the label lies flat rather than standing upright, resolved per
   *  label since a feature can override the material's facing. */
  readFlatFacing: (slot: number) => boolean;
  /** Whether the label is currently walked backwards, which feeds the kernel's
   *  flip hysteresis. */
  readFlip: (slot: number) => boolean;
};

/**
 * How far the text runs from its anchor along the line, in ems.
 *
 * The anchor is the text's centre only when `center.x` is 0.5; otherwise one
 * side is longer, and it is that side that has to fit. The shader lays glyphs
 * out over `[-cx·w, (1 - cx)·w]` (see `wordCenterEm` in sdfText.vert.glsl).
 */
function reachEm(label: PackableLabel, centerX: number): number {
  return Math.max(Math.abs(centerX), Math.abs(1 - centerX)) * label.widthEm;
}

/**
 * Flatten labels into the fit pre-pass's compact input.
 *
 * Deliberately carries no path samples: whether a label is short enough to sit
 * on its line, and whether its level is the one on screen, depend only on the
 * anchor, the label's width, the length of line under it and its scale band.
 * Those are 11 scalars against the 32 path points the full pass needs, and on a
 * dense view most labels fail this test — so running it first, over this
 * array, keeps the large payload off the boundary for the labels that were
 * never going to be placed.
 *
 * Field order must match `LINE_LABEL_FIT_STRIDE`'s table in `line_label.rs`.
 */
export function packLineLabelFits(
  labels: readonly PackableLabel[],
  path: LinePath,
  options: Pick<LinePlacementOptions, "sizeInMeters" | "center">,
): Float64Array {
  const out = new Float64Array(labels.length * LINE_LABEL_FIT_STRIDE);
  const metric = options.sizeInMeters ? 1 : 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const o = i * LINE_LABEL_FIT_STRIDE;
    out[o] = label.anchor[0];
    out[o + 1] = label.anchor[1];
    out[o + 2] = label.anchor[2];
    out[o + 3] = label.addHeight;
    out[o + 4] = reachEm(label, options.center[0]);
    out[o + 5] = label.fontSize;
    out[o + 6] = metric;
    out[o + 7] = usableHalfExtentMeters(path, label.instanceIndex);
    out[o + 8] = scaleBandMin(path, label.instanceIndex);
    out[o + 9] = scaleBandMax(path, label.instanceIndex);
    out[o + 10] = label.widthEm;
  }
  return out;
}

/**
 * Flatten labels and their path samples into the kernel's two input arrays.
 *
 * Field order must match the table in `line_label.rs`; the two move together.
 */
export function packLineLabels(
  labels: readonly PackableLabel[],
  path: LinePath,
  options: LinePlacementOptions,
): { labels: Float64Array; paths: Float32Array } {
  const n = labels.length;
  const stride = path.stride;
  const out = new Float64Array(n * LINE_LABEL_STRIDE);
  const paths = new Float32Array(n * stride);
  const samples = path.samples;
  const meta = path.meta;
  const bearings = path.bearings;
  const maxAngleRad = MathUtils.degToRad(options.maxAngleDeg);

  for (let i = 0; i < n; i++) {
    const label = labels[i];
    const o = i * LINE_LABEL_STRIDE;
    out[o] = label.anchor[0];
    out[o + 1] = label.anchor[1];
    out[o + 2] = label.anchor[2];
    out[o + 3] = label.addHeight;
    out[o + 4] = reachEm(label, options.center[0]);
    out[o + 5] = label.fontSize;
    out[o + 6] = options.sizeInMeters ? 1 : 0;
    out[o + 7] = maxAngleRad;
    out[o + 8] = options.keepUpright ? 1 : 0;
    out[o + 9] = meta?.[label.instanceIndex * PATH_META_STRIDE] ?? 0;
    out[o + 10] = usableHalfExtentMeters(path, label.instanceIndex);
    out[o + 11] = MathUtils.degToRad(bearings?.[label.instanceIndex] ?? 0);
    out[o + 12] = options.readFlip(label.slot) ? 1 : 0;

    // The unrotated collision box, in the font's own units. Computed here
    // rather than in Rust so the em-and-anchor arithmetic stays in the one
    // place that also builds the box for point labels. `lineOffset` is already
    // in these units but goes separately: it always moves the text across the
    // ground, while the text's height stands along the surface normal unless
    // it lies flat, so the kernel projects the two differently.
    const [cx, cy] = options.center;
    const w = label.widthEm;
    const h = label.heightEm;
    out[o + 13] = (0 - cx * w) * label.fontSize;
    out[o + 14] = (w - cx * w) * label.fontSize;
    out[o + 15] = (label.minYEm - cy * h) * label.fontSize;
    out[o + 16] = (label.maxYEm - cy * h) * label.fontSize;
    out[o + 17] = options.lineOffset;
    out[o + 18] = options.readFlatFacing(label.slot) ? 1 : 0;
    out[o + 19] = scaleBandMin(path, label.instanceIndex);
    out[o + 20] = scaleBandMax(path, label.instanceIndex);
    out[o + 21] = label.widthEm;
    out[o + 22] = label.maxWordHalfEm * label.fontSize;

    // Labels are created lazily and sparsely, so their path runs are gathered
    // into input order rather than passed as one contiguous slice.
    paths.set(
      samples.subarray(
        label.instanceIndex * stride,
        (label.instanceIndex + 1) * stride,
      ),
      i * stride,
    );
  }

  return { labels: out, paths };
}

/**
 * Lift the line path out of a freshly extracted geometry, or `null` when that
 * geometry carries none.
 *
 * Separated from the position info because the two have different lifetimes: a
 * geometry update replaces the positions on every terrain height change, while
 * the path is fixed for the tile.
 */
export function takeLinePath(
  info: {
    pathSamples: Float32Array<ArrayBufferLike> | null;
    pathStride: number;
    pathMeta: Float32Array<ArrayBufferLike> | null;
    bearings: Float32Array<ArrayBufferLike> | null;
    scaleBands: Float32Array<ArrayBufferLike> | null;
  } | null,
): LinePath | null {
  if (!info?.pathSamples || info.pathStride <= 0) return null;
  return {
    samples: info.pathSamples,
    stride: info.pathStride,
    meta: info.pathMeta,
    bearings: info.bearings,
    scaleBands: info.scaleBands,
  };
}

/** What {@link findRepeatedLabels} reads of a placed label. */
export type RepeatableLabel = {
  instanceIndex: number;
  text: string;
  anchor: Float64Array;
};

/**
 * MapLibre's text repeat test (`anchorIsTooClose` in `symbol_layout.ts`): a
 * label whose text already has a placed anchor in the same batch closer than
 * half the spacing is dropped. It keeps two carriageways of one road, or a
 * road split into several features, from labelling the same spot twice. A
 * single line's own repeats are at least `spacing` apart, so never trip it.
 *
 * `labels` are the labels the placement pass accepted and `metersPerPx` their
 * scale at the anchor, in the same order. Labels are judged in anchor order,
 * as MapLibre walks a tile's features, so the first of a pair is kept. Returns
 * the indices, into `labels`, of the ones to drop. An unusable spacing places
 * no pattern to repeat, so nothing is dropped.
 *
 * A GeoJSON source is one batch, so a common name can have thousands of
 * accepted repeats in a pass, and comparing each against every kept one is
 * quadratic. Kept anchors are filed in a grid instead. The limit differs per
 * label, so one cell size cannot fit them all: each anchor is filed at every
 * power-of-two cell size that some label in this pass needs, and each label
 * looks only at the 27 cells around it at the smallest size not under its own
 * limit, which hold everything that close.
 */
export function findRepeatedLabels(
  labels: readonly RepeatableLabel[],
  metersPerPx: ArrayLike<number>,
  spacingPx: number,
): number[] {
  if (!(spacingPx > 0 && Number.isFinite(spacingPx))) return [];
  const limit = (i: number) => 0.5 * spacingPx * metersPerPx[i];
  // Accepted labels are in their scale band, so `metersPerPx` is positive.
  const level = (i: number) => Math.ceil(Math.log2(limit(i)));
  let minLevel = Infinity;
  let maxLevel = -Infinity;
  for (let i = 0; i < labels.length; i++) {
    minLevel = Math.min(minLevel, level(i));
    maxLevel = Math.max(maxLevel, level(i));
  }

  const order = labels.map((_, i) => i);
  order.sort((a, b) => labels[a].instanceIndex - labels[b].instanceIndex);
  const cellKey = (lv: number, x: number, y: number, z: number) =>
    `${lv},${x},${y},${z}`;
  // Per text, the kept anchors in each cell of each level.
  const kept = new Map<string, Map<string, Float64Array[]>>();
  const repeated: number[] = [];
  for (const i of order) {
    const { text, anchor } = labels[i];
    let grid = kept.get(text);
    if (grid && hasKeptWithin(grid, anchor, limit(i), level(i), cellKey)) {
      repeated.push(i);
      continue;
    }
    if (!grid) {
      grid = new Map();
      kept.set(text, grid);
    }
    for (let lv = minLevel; lv <= maxLevel; lv++) {
      const size = 2 ** lv;
      const key = cellKey(
        lv,
        Math.floor(anchor[0] / size),
        Math.floor(anchor[1] / size),
        Math.floor(anchor[2] / size),
      );
      const cell = grid.get(key);
      if (cell) cell.push(anchor);
      else grid.set(key, [anchor]);
    }
  }
  return repeated;
}

/** Whether `grid` holds an anchor closer than `limit` to `anchor`, searching
 *  the cells of `lv`, whose size is at least `limit`. */
function hasKeptWithin(
  grid: Map<string, Float64Array[]>,
  anchor: Float64Array,
  limit: number,
  lv: number,
  cellKey: (lv: number, x: number, y: number, z: number) => string,
): boolean {
  const size = 2 ** lv;
  const cx = Math.floor(anchor[0] / size);
  const cy = Math.floor(anchor[1] / size);
  const cz = Math.floor(anchor[2] / size);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = grid.get(cellKey(lv, cx + dx, cy + dy, cz + dz));
        if (!cell) continue;
        for (const o of cell) {
          const d2 =
            (o[0] - anchor[0]) ** 2 +
            (o[1] - anchor[1]) ** 2 +
            (o[2] - anchor[2]) ** 2;
          if (d2 < limit * limit) return true;
        }
      }
    }
  }
  return false;
}
