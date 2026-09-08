import type { BatchScalarSlotKey, BatchSlot, BatchVec3Key } from "./types";

// Batch data texture layout (RGBA float, one texel = 4 full-precision scalars):
// slots are assigned per attribute by BatchTextureLayout and stamped as
// BATCHED_TEXTURE_ROW_* / _COMP_* defines:
// - vec3 attributes (color, …) take components 0-2 of a fresh row; the row's
//   component 3 returns to the scalar pool.
// - Scalar attributes take one texel component each, filling free components
//   (vec3 leftovers first) before opening a new row. show and opacity share
//   one packed component (see packShowOpacity).

// Maximum batch texture width to stay within WebGL texture size limits (max 16384).
// Using 4096 as a safe default that balances memory layout with broad GPU support.
export const MAX_BATCH_TEXTURE_WIDTH = 4096;

/**
 * Mutable row/component assignment for a batch data texture.
 *
 * Allocation is append-only: once assigned, a slot never moves, so defines
 * stamped from it stay valid and growing the texture is a plain append of new
 * attribute rows (see {@link batchBaseIndex}). vec3 attributes take
 * components 0-2 of a fresh row and hand component 3 to the scalar pool;
 * scalars fill free components (oldest first) before opening a new row, so no
 * component is wasted regardless of allocation order.
 */
export class BatchTextureLayout {
  /** Number of allocated attribute rows. */
  rows = 0;
  private vec3Rows = new Map<BatchVec3Key, number>();
  private scalarSlots = new Map<BatchScalarSlotKey, BatchSlot>();
  private freeComps: BatchSlot[] = [];

  getVec3Row(key: BatchVec3Key): number | undefined {
    return this.vec3Rows.get(key);
  }

  get vec3s(): ReadonlyMap<BatchVec3Key, number> {
    return this.vec3Rows;
  }

  allocateVec3(key: BatchVec3Key): number {
    const existing = this.vec3Rows.get(key);
    if (existing != null) return existing;
    const row = this.rows++;
    this.vec3Rows.set(key, row);
    this.freeComps.push({ row, comp: 3 });
    return row;
  }

  getScalarSlot(key: BatchScalarSlotKey): BatchSlot | undefined {
    return this.scalarSlots.get(key);
  }

  get scalars(): ReadonlyMap<BatchScalarSlotKey, BatchSlot> {
    return this.scalarSlots;
  }

  allocateScalar(key: BatchScalarSlotKey): BatchSlot {
    const existing = this.scalarSlots.get(key);
    if (existing) return existing;
    let slot = this.freeComps.shift();
    if (!slot) {
      const row = this.rows++;
      slot = { row, comp: 0 };
      this.freeComps.push({ row, comp: 1 }, { row, comp: 2 }, { row, comp: 3 });
    }
    this.scalarSlots.set(key, slot);
    return slot;
  }
}

/**
 * Compute the flat float-array index for a given batchId and attribute row
 * in the 2D texture layout.
 *
 * Layout is planar: batch IDs are arranged in a grid of width `texWidth`
 * spanning `batchRowGroups` (= ceil(batchLength / texWidth)) rows, and each
 * attribute row occupies one contiguous block of `batchRowGroups` physical
 * rows. Keeping each attribute row contiguous means adding a row later is a
 * plain append — existing data never has to be re-scattered.
 *
 * Physical row = rowIndex * batchRowGroups + floor(batchId / texWidth)
 * Physical col = batchId % texWidth
 * Flat index   = (physicalRow * texWidth + physicalCol) * 4
 */
export function batchBaseIndex(
  texWidth: number,
  batchRowGroups: number,
  batchId: number,
  rowIndex: number,
): number {
  const col = batchId % texWidth;
  const batchRow = Math.floor(batchId / texWidth);
  const physicalRow = rowIndex * batchRowGroups + batchRow;
  return (physicalRow * texWidth + col) * 4;
}
