import {
  ReturnedConstructedTerrainMeshLike,
  TransferableRasterDEMDataLike,
  TransferableTileLike,
} from "@navaramap/core";
import type { Promise } from "@navaramap/worker";

import { queueTask } from "./queueTask";

export function upsampleTerrainMesh(
  tileLike: TransferableTileLike,
  sourceTileLike: TransferableTileLike,
  rasterDEMDataLike: TransferableRasterDEMDataLike,
  sourceBytes: Uint8Array,
  size: number,
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
      sourceTileLike,
      rasterDEMDataLike,
      sourceBytes,
      size,
      skirt,
      skirtExaggeration,
      poleNorth,
      poleSouth,
      tms,
    ],
    { transfer: [sourceBytes.buffer] },
  );
}
