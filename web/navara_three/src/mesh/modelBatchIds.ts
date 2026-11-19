import type { BufferAttribute, InterleavedBufferAttribute } from "three";

/**
 * Maps each vertex's feature index (`_batchid`) to its global batch id, 0
 * where the index has none. Read through the attribute rather than its
 * array: a b3dm `_BATCHID` of 1-byte components is padded to a 4-byte
 * stride, which three loads as an interleaved attribute.
 */
export function vertexGlobalBatchIds(
  featureIndices: BufferAttribute | InterleavedBufferAttribute,
  globalBatchIds: ArrayLike<number>,
): Float32Array {
  const ids = new Float32Array(featureIndices.count);
  for (let i = 0; i < ids.length; i++) {
    ids[i] = globalBatchIds[featureIndices.getX(i)] ?? 0;
  }
  return ids;
}
