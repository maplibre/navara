import {
  ConstructedPolygonGeometryLike,
  ExtentRadianF32Like,
  PolygonMaterialLike,
  TransferablePolygonBatchedFeatureLike,
} from "@navaramap/core";
import type { Promise } from "@navaramap/worker";

import { queueTask } from "./queueTask";

export function constructPolygonBatchedFeature(
  transferableBatchedFeatureLike: TransferablePolygonBatchedFeatureLike,
  materialLike: PolygonMaterialLike,
  flat: boolean,
  tileExtent: ExtentRadianF32Like | undefined,
): Promise<ConstructedPolygonGeometryLike | undefined> {
  return queueTask(
    "constructPolygonBatchedFeature",
    [transferableBatchedFeatureLike, materialLike, flat, tileExtent],
    {
      transfer: [
        transferableBatchedFeatureLike.batch_ids.buffer,
        transferableBatchedFeatureLike.batch_indices.buffer,
        transferableBatchedFeatureLike.expected_winding_orders.buffer,
        transferableBatchedFeatureLike.holes.buffer,
        transferableBatchedFeatureLike.holes_boundaries.buffer,
        transferableBatchedFeatureLike.holes_sizes.buffer,
        transferableBatchedFeatureLike.holes_total_sizes.buffer,
        transferableBatchedFeatureLike.outer_ring.buffer,
        transferableBatchedFeatureLike.outer_ring_sizes.buffer,
        transferableBatchedFeatureLike.outline_edges.buffer,
      ],
    },
  );
}
