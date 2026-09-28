import {
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
} from "three";

import type { GlyphQuad } from "./layout";

/**
 * The glyph-instance geometry of a batched text mesh: a shared unit quad plus
 * one instance per glyph, drawn in a single call for every label in the batch.
 *
 * Instances are grouped into contiguous per-label runs handed out by
 * `GlyphSlotAllocator`, so writing a label pushes only that run to the GPU via
 * `addUpdateRange`. Growth doubles the buffers, which is the only path that
 * re-uploads everything.
 */

/** Per-instance `glyphKind` values. Must match the `GLYPH_KIND_*` defines in
 *  `shaders/glsl/sdfText.vert.glsl`. */
export const GlyphKind = {
  SDF: 0,
  COLOR: 1,
  BACKGROUND: 2,
  /** A slot inside a label's run that its text doesn't use, or a hole left by
   *  a freed run. Culled in the vertex shader. */
  EMPTY: 3,
} as const;

/** Instance slots a freshly-created batch reserves. */
const INITIAL_CAPACITY = 64;

/** Upper bound on {@link backgroundSliceCount}. */
const MAX_BACKGROUND_SLICES = 8;

/**
 * Instances a label's background is split into: vertical strips side by side,
 * one per two glyphs, capped at {@link MAX_BACKGROUND_SLICES}.
 *
 * A flat label is wrapped onto the globe per vertex (`nvr_quadOffset` in
 * `quad_orientation.glsl`), so a single background quad stays a straight
 * chord between its four bent corners while the glyphs above it follow the
 * curve, and at globe scale the text visibly rises out of its box. Strips
 * about as wide as the glyphs bend the same way the glyphs do. The fragment
 * shader draws a background purely from its UV, which each strip remaps to
 * its span, so the split is pixel-identical for upright labels.
 */
export function backgroundSliceCount(quadCount: number): number {
  return Math.min(MAX_BACKGROUND_SLICES, Math.max(1, Math.ceil(quadCount / 2)));
}

/** Attribute name and component count, in the order they are (re)created. */
const INSTANCE_ATTRIBUTES = [
  ["glyphOffset", 2],
  ["glyphSize", 2],
  ["glyphUvRect", 4],
  ["glyphKind", 1],
  ["labelIndex", 1],
] as const;

/** The backing arrays, one per instance attribute. */
type InstanceArrays = {
  glyphOffset: Float32Array;
  glyphSize: Float32Array;
  glyphUvRect: Float32Array;
  glyphKind: Float32Array;
  labelIndex: Float32Array;
};

export class GlyphBuffers {
  readonly geometry: InstancedBufferGeometry;
  private _capacity: number;
  private _arrays: InstanceArrays;
  /** The live instance attributes, paired with their component count.
   *  Held directly so partial uploads don't go through `getAttribute`, whose
   *  union return type doesn't expose `addUpdateRange`. */
  private _attributes: [InstancedBufferAttribute, number][] = [];

  constructor(initialCapacity = INITIAL_CAPACITY) {
    this._capacity = Math.max(1, initialCapacity);
    this.geometry = new InstancedBufferGeometry();

    // Unit quad: 2 triangles, 6 vertices.
    // prettier-ignore
    const positions = new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0,
      -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]);
    // prettier-ignore
    const uvs = new Float32Array([
      0, 0, 1, 0, 1, 1,
      0, 0, 1, 1, 0, 1,
    ]);
    this.geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.geometry.setAttribute("uv", new BufferAttribute(uvs, 2));

    this._arrays = this._allocate(this._capacity);
    this.geometry.instanceCount = 0;
  }

  get capacity(): number {
    return this._capacity;
  }

  /** Instances the draw call covers — the allocator's high-water mark. */
  setInstanceCount(count: number): void {
    this.geometry.instanceCount = count;
  }

  /**
   * Grow to hold at least `slotCount` instances, preserving existing data.
   * No-op when it already fits.
   */
  ensureCapacity(slotCount: number): void {
    if (slotCount <= this._capacity) return;
    let capacity = this._capacity;
    while (capacity < slotCount) capacity *= 2;

    const previousCapacity = this._capacity;
    this._capacity = capacity;
    this._arrays = this._allocate(capacity, this._arrays, previousCapacity);

    // three caches the instance ceiling on the first VAO bind and only clears
    // it when the geometry is disposed, then clamps every draw with
    // `min(geometry.instanceCount, geometry._maxInstanceCount)`. Replacing the
    // instance attributes with larger ones does NOT refresh it, so without this
    // the batch stays pinned to whatever capacity it had when it was first
    // rendered — labels added later silently never draw. Dropping the cached
    // value makes three recompute it from the new attributes on the next bind.
    delete (
      this.geometry as InstancedBufferGeometry &
        Partial<Record<"_maxInstanceCount", number>>
    )._maxInstanceCount;
  }

  /**
   * Write a label's glyph quads into its run and blank the rest of it, then
   * queue a partial upload of exactly that range.
   *
   * `runCapacity` is the slots the label owns; anything past the quads becomes
   * {@link GlyphKind.EMPTY}, so an over-allocated run — or a label whose text
   * just got shorter — draws nothing in the leftover slots.
   */
  writeRun(
    start: number,
    runCapacity: number,
    labelIndex: number,
    quads: GlyphQuad[],
    withBackground: boolean,
  ): void {
    const {
      glyphOffset,
      glyphSize,
      glyphUvRect,
      glyphKind,
      labelIndex: label,
    } = this._arrays;

    // The background occupies the run's first slots so it is drawn before the
    // label's glyphs — the fragment shader's outline-seam fix depends on that
    // ordering (see sdfText.frag.glsl).
    let slot = start;
    if (withBackground) {
      const slices = backgroundSliceCount(quads.length);
      for (let i = 0; i < slices; i++) {
        glyphKind[slot] = GlyphKind.BACKGROUND;
        label[slot] = labelIndex;
        // The background derives its quad from the label's box. The glyph
        // fields carry only this strip's horizontal span of it, as [0, 1]
        // fractions: start in offset.x, end in size.x. Storing the end (not
        // a width) makes neighbouring strips share bit-identical edges, so
        // they meet without cracks.
        glyphOffset[slot * 2] = i / slices;
        glyphOffset[slot * 2 + 1] = 0;
        glyphSize[slot * 2] = (i + 1) / slices;
        glyphSize[slot * 2 + 1] = 0;
        slot++;
      }
    }

    for (const q of quads) {
      glyphKind[slot] = q.isColor ? GlyphKind.COLOR : GlyphKind.SDF;
      label[slot] = labelIndex;
      glyphOffset[slot * 2] = q.offsetEmX;
      glyphOffset[slot * 2 + 1] = q.offsetEmY;
      glyphSize[slot * 2] = q.sizeEmX;
      glyphSize[slot * 2 + 1] = q.sizeEmY;
      glyphUvRect[slot * 4] = q.uvL;
      glyphUvRect[slot * 4 + 1] = q.uvT;
      glyphUvRect[slot * 4 + 2] = q.uvR;
      glyphUvRect[slot * 4 + 3] = q.uvB;
      slot++;
    }

    for (; slot < start + runCapacity; slot++) {
      glyphKind[slot] = GlyphKind.EMPTY;
      label[slot] = labelIndex;
    }

    this._queueUpload(start, runCapacity);
  }

  /** Blank a run so its slots draw nothing until reallocated. */
  clearRun(start: number, runCapacity: number): void {
    this._arrays.glyphKind.fill(GlyphKind.EMPTY, start, start + runCapacity);
    this._queueUpload(start, runCapacity);
  }

  dispose(): void {
    this.geometry.dispose();
  }

  /** Queue a `bufferSubData` covering `[start, start + count)` instances on
   *  every instance attribute. */
  private _queueUpload(start: number, count: number): void {
    for (const [attr, itemSize] of this._attributes) {
      // addUpdateRange takes array-element units, not instance units.
      attr.addUpdateRange(start * itemSize, count * itemSize);
      attr.needsUpdate = true;
    }
  }

  /**
   * (Re)create the instance attributes at `capacity`, copying `previous` in.
   * Slots past the copied region start as EMPTY — a zero-filled array would
   * otherwise read as `GlyphKind.SDF` and draw garbage quads.
   */
  private _allocate(
    capacity: number,
    previous?: InstanceArrays,
    previousCapacity = 0,
  ): InstanceArrays {
    const arrays = {} as InstanceArrays;
    this._attributes = [];
    for (const [name, itemSize] of INSTANCE_ATTRIBUTES) {
      const array = new Float32Array(capacity * itemSize);
      if (previous) array.set(previous[name]);
      if (name === "glyphKind") {
        array.fill(GlyphKind.EMPTY, previousCapacity, capacity);
      }
      arrays[name] = array;
      const attr = new InstancedBufferAttribute(array, itemSize);
      this.geometry.setAttribute(name, attr);
      this._attributes.push([attr, itemSize]);
    }
    return arrays;
  }
}
