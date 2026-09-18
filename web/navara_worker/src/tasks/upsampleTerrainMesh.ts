import {
  ReturnedConstructedTerrainMeshLike,
  TransferableRasterDEMDataLike,
  TransferableTileLike,
  UpsamplableTerrainGeometryLike,
} from "@navaramap/core";
import { upsampleTerrainMesh as upsampleTerrainMeshImpl } from "@navaramap/engine-worker";

import { transfer } from "..";
import { transferReturnedConstructedTerrainMesh } from "../helpers/transferReturnedConstructedTerrainMesh";
import { toTransferableTile, toUpsamplableTerrainGeometry } from "../utils";
import { toTransferableRasterDEMDataLike } from "../utils/toTransferableRasterDEMDataLike";

import { waitWasm } from "./waitWasm";

export async function upsampleTerrainMesh(
  tile: TransferableTileLike,
  parentTile: TransferableTileLike,
  rasterDEMData: TransferableRasterDEMDataLike,
  upsamplableGeometry: UpsamplableTerrainGeometryLike,
  skirt: boolean,
  skirtExaggeration: number,
  poleNorth: boolean,
  poleSouth: boolean,
  tms: boolean,
): Promise<ReturnedConstructedTerrainMeshLike> {
  await waitWasm();

  const mesh = upsampleTerrainMeshImpl(
    toTransferableTile(tile),
    toTransferableTile(parentTile),
    toTransferableRasterDEMDataLike(rasterDEMData),
    toUpsamplableTerrainGeometry(upsamplableGeometry),
    skirt,
    skirtExaggeration,
    poleNorth,
    poleSouth,
    tms,
  );
  const { result, transfers } = transferReturnedConstructedTerrainMesh(mesh);
  mesh.free();

  return transfer(result, transfers);
}
