/**
 * Group instances by their feature's batch index from a geometry's
 * per-instance `batch_index` buffer. Returns `null` for a missing buffer or
 * an identity mapping (every feature owns exactly one instance, the common
 * case) so callers can skip the map entirely. The result owns fresh arrays:
 * the source u32 view is consumed synchronously and must not outlive the
 * call (other wasm calls may detach views).
 */
export function buildBatchIndexMap(batchIndices: Uint32Array | null): {
  /** Per-instance feature (batch) index, for CPU-side reads and the
   *  `_batchid` attribute. */
  perInstance: Float32Array;
  /** Feature (batch) index → instance ids owned by that feature. */
  byBatchIndex: Map<number, number[]>;
} | null {
  if (!batchIndices) return null;

  let identity = true;
  for (let i = 0; i < batchIndices.length; i++) {
    if (batchIndices[i] !== i) {
      identity = false;
      break;
    }
  }
  if (identity) return null;

  const perInstance = new Float32Array(batchIndices.length);
  const byBatchIndex = new Map<number, number[]>();
  for (let i = 0; i < batchIndices.length; i++) {
    const batchIndex = batchIndices[i];
    perInstance[i] = batchIndex;
    let instances = byBatchIndex.get(batchIndex);
    if (!instances) {
      instances = [];
      byBatchIndex.set(batchIndex, instances);
    }
    instances.push(i);
  }
  return { perInstance, byBatchIndex };
}
