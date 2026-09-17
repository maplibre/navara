import {
  ConstructedPolylineGeometryLike,
  PolylineMaterialLike,
  TransferablePolylineBatchedFeatureLike,
} from "@navaramap/core";
import type { Promise } from "@navaramap/worker";

import { queueTask } from "./queueTask";

export function constructPolylineBatchedFeature(
  transferableBatchedFeatureLike: TransferablePolylineBatchedFeatureLike,
  materialLike: PolylineMaterialLike,
  flat: boolean,
): Promise<ConstructedPolylineGeometryLike | undefined> {
  return queueTask(
    "constructPolylineBatchedFeature",
    [transferableBatchedFeatureLike, materialLike, flat],
    {
      transfer: [
        transferableBatchedFeatureLike.points.buffer,
        transferableBatchedFeatureLike.points_sizes.buffer,
        transferableBatchedFeatureLike.batch_ids.buffer,
        transferableBatchedFeatureLike.batch_indices.buffer,
        transferableBatchedFeatureLike.ring_flags.buffer,
      ],
    },
  );
}
