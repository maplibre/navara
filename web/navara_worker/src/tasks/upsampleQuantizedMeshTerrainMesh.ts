import {
  ReturnedConstructedTerrainMeshLike,
  TransferableTileLike,
  UpsamplableTerrainGeometryLike,
} from "@navaramap/core";
import { upsampleQuantizedMeshTerrainMesh as upsampleQuantizedMeshTerrainMeshImpl } from "@navaramap/engine-worker";

import { transfer } from "..";
import { transferReturnedConstructedTerrainMesh } from "../helpers/transferReturnedConstructedTerrainMesh";
import { toTransferableTile, toUpsamplableTerrainGeometry } from "../utils";

import { waitWasm } from "./waitWasm";

export async function upsampleQuantizedMeshTerrainMesh(
  tile: TransferableTileLike,
  parentTile: TransferableTileLike,
  upsamplableGeometry: UpsamplableTerrainGeometryLike,
  skirt: boolean,
  skirtExaggeration: number,
  poleNorth: boolean,
  poleSouth: boolean,
  geographic: boolean,
  tms: boolean,
): Promise<ReturnedConstructedTerrainMeshLike> {
  await waitWasm();

  const mesh = upsampleQuantizedMeshTerrainMeshImpl(
    toTransferableTile(tile),
    toTransferableTile(parentTile),
    toUpsamplableTerrainGeometry(upsamplableGeometry),
    skirt,
    skirtExaggeration,
    poleNorth,
    poleSouth,
    geographic,
    tms,
  );
  const { result, transfers } = transferReturnedConstructedTerrainMesh(mesh);
  mesh.free();

  return transfer(result, transfers);
}
