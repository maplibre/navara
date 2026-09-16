import type { TransferablePolylineBatchedFeatureLike } from "@navaramap/core";
import { TransferablePolylineBatchedFeature } from "@navaramap/engine-worker";

export function toTransferablePolylineBatchedFeatureLike(
  like: TransferablePolylineBatchedFeatureLike,
) {
  const t = new TransferablePolylineBatchedFeature(like.crs, like.length);
  t.setPoints(like.points.length, (b: Float64Array) => {
    b.set(like.points);
  });
  t.setPointsSizes(like.points_sizes.length, (b: Uint32Array) => {
    b.set(like.points_sizes);
  });
  t.setBatchIds(like.batch_ids.length, (b: Uint32Array) => {
    b.set(like.batch_ids);
  });
  t.setBatchIndices(like.batch_indices.length, (b: Uint32Array) => {
    b.set(like.batch_indices);
  });
  t.setRingFlags(like.ring_flags.length, (b: Uint8Array) => {
    b.set(like.ring_flags);
  });
  return t;
}
