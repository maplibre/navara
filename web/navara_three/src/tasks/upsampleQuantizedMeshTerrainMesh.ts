import {
  ReturnedConstructedTerrainMeshLike,
  TransferableTileLike,
  UpsamplableTerrainGeometryLike,
} from "@navaramap/core";
import type { Promise } from "@navaramap/worker";

import { queueTask } from "./queueTask";

export function upsampleQuantizedMeshTerrainMesh(
  tileLike: TransferableTileLike,
  sourceTileLike: TransferableTileLike,
  upsamplableGeometryLike: UpsamplableTerrainGeometryLike,
  skirt: boolean,
  skirtExaggeration: number,
  poleNorth: boolean,
  poleSouth: boolean,
  geographic: boolean,
  tms: boolean,
): Promise<ReturnedConstructedTerrainMeshLike> {
  return queueTask(
    "upsampleQuantizedMeshTerrainMesh",
    [
      tileLike,
      sourceTileLike,
      upsamplableGeometryLike,
      skirt,
      skirtExaggeration,
      poleNorth,
      poleSouth,
      geographic,
      tms,
    ],
    {
      transfer: [
        upsamplableGeometryLike.uvs.buffer,
        upsamplableGeometryLike.heights.buffer,
        upsamplableGeometryLike.indices.buffer,
        ...(upsamplableGeometryLike.normals
          ? [upsamplableGeometryLike.normals.buffer]
          : []),
        ...(upsamplableGeometryLike.watermask
          ? [upsamplableGeometryLike.watermask.buffer]
          : []),
      ],
    },
  );
}
