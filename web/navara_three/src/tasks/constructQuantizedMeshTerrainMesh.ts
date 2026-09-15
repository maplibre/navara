import {
  ReturnedConstructedTerrainMeshLike,
  TransferableTileLike,
} from "@navaramap/core";
import type { Promise } from "@navaramap/worker";

import { queueTask } from "./queueTask";

export function constructQuantizedMeshTerrainMesh(
  bytes: Uint8Array,
  tileLike: TransferableTileLike,
  skirt: boolean,
  skirtExaggeration: number,
  poleNorth: boolean,
  poleSouth: boolean,
  geographic: boolean,
  tms: boolean,
): Promise<{
  result: ReturnedConstructedTerrainMeshLike;
}> {
  return queueTask(
    "constructQuantizedMeshTerrainMesh",
    [
      bytes,
      tileLike,
      skirt,
      skirtExaggeration,
      poleNorth,
      poleSouth,
      geographic,
      tms,
    ],
    { transfer: [bytes.buffer] },
  );
}
