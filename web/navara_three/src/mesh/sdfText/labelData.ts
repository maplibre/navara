import { type DataTexture, Vector2 } from "three";

import {
  LABEL_ROWS,
  LabelRow,
} from "../../material/enhancer/sdfText/sdfTextBaseEnhancer/types";
import { createFloatDataTexture } from "../../utils/floatDataTexture";

export { LABEL_ROWS, LabelRow };

/** Labels a freshly-created store is sized for, before row padding. */
const INITIAL_CAPACITY = 16;

/** Texels per side WebGL2 guarantees a texture can have. */
const MAX_TEXTURE_SIDE = 2048;

/**
 * Texels per row for `texels` texels: the power of two at or above their square
 * root, so the texture stays roughly square and neither side outgrows the label
 * count, capped at {@link MAX_TEXTURE_SIDE}. Both sides then stay under that
 * limit up to 4M texels (800k labels), where a fixed narrow row runs out of
 * height first.
 *
 * Only the linear texel index is an address — the shader splits it by the
 * live `uLabelTexSize` — so a grow is free to pick a wider row.
 */
function widthFor(texels: number): number {
  return Math.min(
    MAX_TEXTURE_SIDE,
    2 ** Math.ceil(Math.log2(Math.sqrt(Math.max(1, texels)))),
  );
}

/** The row width and the floats needed to hold `capacity` labels, padded out
 *  to whole texture rows. */
function allocationFor(
  capacity: number,
  texelsPerSlot: number,
): { width: number; floats: number } {
  const texels = capacity * texelsPerSlot;
  const width = widthFor(texels);
  return { width, floats: Math.ceil(texels / width) * width * 4 };
}

/**
 * Labels an allocation can actually address — the row padding
 * {@link allocationFor} adds is usable space, not slack. Deriving capacity
 * from the buffer instead of from the requested count is what stops
 * `ensureCapacity` from growing while there are still free slots inside the
 * current allocation.
 */
function labelsIn(floats: number, texelsPerSlot: number): number {
  return Math.max(1, Math.floor(floats / 4 / texelsPerSlot));
}

/**
 * Per-label state for a batched text mesh, stored in a float texture that the
 * vertex shader reads with `texelFetch`.
 *
 * A batched mesh's instances are *glyphs*, not labels, so anything that varies
 * per label can't be an instance attribute without replicating it onto every
 * glyph. Indirecting through this texture (via the `labelIndex` attribute)
 * keeps a per-label change — colour, size, the declutter fade running every
 * frame — at a handful of float writes regardless of how many glyphs the label
 * has, and leaves label state untouched when a text change relocates the
 * label's glyph run.
 *
 * Addressing mirrors `fogLight.frag.glsl`: a linear texel index split by the
 * texture's width, sampled unfiltered. The row layout itself
 * ({@link LabelRow} / {@link LABEL_ROWS}) is the shader contract and lives with
 * the enhancer that owns the shader; `LABEL_ROWS` is injected there as a GLSL
 * define so the two addressing schemes can't drift.
 */
export class LabelDataTexture {
  private _capacity = 0;
  private _width = 1;
  private _data: Float32Array;
  private _texture: DataTexture;
  private readonly _size = new Vector2();

  /**
   * @param texelsPerSlot Texels each slot occupies. Defaults to
   *   {@link LABEL_ROWS} for the per-label state texture; the path texture
   *   (`uPathData`) uses the same machinery with its own, much wider stride.
   */
  constructor(
    initialCapacity = INITIAL_CAPACITY,
    private readonly _texelsPerSlot: number = LABEL_ROWS,
  ) {
    this._data = this._allocate(Math.max(1, initialCapacity));
    this._capacity = labelsIn(this._data.length, _texelsPerSlot);
    this._texture = this._createTexture();
  }

  /** The texture to bind to `uLabelData`. Replaced by {@link ensureCapacity}. */
  get texture(): DataTexture {
    return this._texture;
  }

  /** Dimensions in texels, for the `uLabelTexSize` uniform. */
  get size(): Vector2 {
    return this._size;
  }

  /**
   * Labels addressable without a grow. Derived from the allocation, so it
   * includes the row padding and is generally larger than the count the store
   * was constructed or grown for.
   */
  get capacity(): number {
    return this._capacity;
  }

  /**
   * Make room for `slotCount` labels.
   *
   * Returns `true` when the backing `DataTexture` was replaced, in which case
   * the caller must re-point the `uLabelData` uniform and refresh
   * `uLabelTexSize`: the new texture may be wider. Existing label data
   * survives unchanged at the same linear index.
   */
  ensureCapacity(slotCount: number): boolean {
    if (slotCount <= this._capacity) return false;

    let target = this._capacity;
    while (target < slotCount) target *= 2;
    // Near the limit, doubling would overshoot a texture the request itself
    // still fits in: grow only as far as the limit allows. A request past it
    // gets exactly what it asked for, and only a GPU above the guarantee can
    // upload that.
    const limit = Math.floor(MAX_TEXTURE_SIDE ** 2 / this._texelsPerSlot);
    target = Math.max(slotCount, Math.min(target, limit));

    const data = this._allocate(target);
    data.set(this._data);

    this._data = data;
    this._capacity = labelsIn(data.length, this._texelsPerSlot);
    this._texture.dispose();
    this._texture = this._createTexture();
    return true;
  }

  /** Write a whole texel. */
  setRow(
    slot: number,
    row: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    const i = (slot * this._texelsPerSlot + row) * 4;
    const data = this._data;
    data[i] = x;
    data[i + 1] = y;
    data[i + 2] = z;
    data[i + 3] = w;
    this._texture.needsUpdate = true;
  }

  /** Write one channel of a texel, leaving the other three alone. Writing the
   *  value already stored requests no upload: placement passes rewrite every
   *  label's decisions, and most are unchanged. */
  setComponent(
    slot: number,
    row: number,
    component: number,
    value: number,
  ): void {
    const i = (slot * this._texelsPerSlot + row) * 4 + component;
    if (this._data[i] === Math.fround(value)) return;
    this._data[i] = value;
    this._texture.needsUpdate = true;
  }

  /** Read one channel back — used by the declutter fade's read/modify/write. */
  getComponent(slot: number, row: number, component: number): number {
    return this._data[(slot * this._texelsPerSlot + row) * 4 + component];
  }

  /** Zero a label's rows so a recycled slot can't inherit stale state. */
  clearSlot(slot: number): void {
    const start = slot * this._texelsPerSlot * 4;
    this._data.fill(0, start, start + this._texelsPerSlot * 4);
    this._texture.needsUpdate = true;
  }

  /** Mark the texture for re-upload without writing anything. */
  markDirty(): void {
    this._texture.needsUpdate = true;
  }

  dispose(): void {
    this._texture.dispose();
  }

  /** A zeroed buffer for `capacity` labels; sets the row width it is laid out
   *  on. The linear layout does not depend on the width, so the old data copies
   *  straight in. */
  private _allocate(capacity: number): Float32Array {
    const { width, floats } = allocationFor(capacity, this._texelsPerSlot);
    this._width = width;
    return new Float32Array(floats);
  }

  private _createTexture(): DataTexture {
    // Derived from the buffer rather than recomputed from `_capacity`: the
    // texture must describe exactly the memory it is backed by.
    const height = this._data.length / (this._width * 4);
    const tex = createFloatDataTexture(this._data, this._width, height);
    this._size.set(this._width, height);
    return tex;
  }
}
