import {
  ReturnedConstructedTerrainMeshLike,
  TransferableRasterDEMDataLike,
  TransferableTileLike,
  UpsamplableTerrainGeometryLike,
} from "@navaramap/core";
import type { Promise } from "@navaramap/worker";

import { queueTask } from "./queueTask";

export function upsampleTerrainMesh(
  tileLike: TransferableTileLike,
  parentTileLike: TransferableTileLike,
  rasterDEMDataLike: TransferableRasterDEMDataLike,
  upsamplableGeometryLike: UpsamplableTerrainGeometryLike,
  skirt: boolean,
  skirtExaggeration: number,
  poleNorth: boolean,
  poleSouth: boolean,
  tms: boolean,
): Promise<ReturnedConstructedTerrainMeshLike> {
  return queueTask(
    "upsampleTerrainMesh",
    [
      tileLike,
      parentTileLike,
      rasterDEMDataLike,
      upsamplableGeometryLike,
      skirt,
      skirtExaggeration,
      poleNorth,
      poleSouth,
      tms,
    ],
    {
      transfer: [
        upsamplableGeometryLike.uvs.buffer,
        upsamplableGeometryLike.heights.buffer,
        upsamplableGeometryLike.indices.buffer,
      ],
    },
  );
}
