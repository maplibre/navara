import type {
  TransferableTileLike,
  TransferableRasterDEMDataLike,
  ReturnedConstructedTerrainMeshLike,
} from "@navaramap/core";
import { constructTerrainMesh as constructTerrainMeshImpl } from "@navaramap/engine-worker";

import { transfer } from "..";
import { transferReturnedConstructedTerrainMesh } from "../helpers/transferReturnedConstructedTerrainMesh";
import { toTransferableTile } from "../utils";
import { toTransferableRasterDEMDataLike } from "../utils/toTransferableRasterDEMDataLike";

import { waitWasm } from "./waitWasm";

export async function constructTerrainMesh(
  bytes: Uint8Array,
  tile: TransferableTileLike,
  rasterDEMData: TransferableRasterDEMDataLike,
  size: number,
  skirt: boolean,
  skirtExaggeration: number,
  poleNorth: boolean,
  poleSouth: boolean,
): Promise<{
  result: ReturnedConstructedTerrainMeshLike;
}> {
  await waitWasm();

  const mesh = constructTerrainMeshImpl(
    bytes,
    toTransferableTile(tile),
    toTransferableRasterDEMDataLike(rasterDEMData),
    size + 1,
    skirt,
    skirtExaggeration,
    poleNorth,
    poleSouth,
  );
  const { result, transfers } = transferReturnedConstructedTerrainMesh(mesh);
  mesh.free();
  return transfer({ result }, [...transfers]);
}
