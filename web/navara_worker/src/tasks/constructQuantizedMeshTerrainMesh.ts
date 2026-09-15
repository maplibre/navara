import type {
  ReturnedConstructedTerrainMeshLike,
  TransferableTileLike,
} from "@navaramap/core";
import { constructQuantizedMeshTerrainMesh as constructQuantizedMeshTerrainMeshImpl } from "@navaramap/engine-worker";

import { transfer } from "..";
import { transferReturnedConstructedTerrainMesh } from "../helpers/transferReturnedConstructedTerrainMesh";
import { toTransferableTile } from "../utils";

import { waitWasm } from "./waitWasm";

export async function constructQuantizedMeshTerrainMesh(
  bytes: Uint8Array,
  tile: TransferableTileLike,
  skirt: boolean,
  skirtExaggeration: number,
  poleNorth: boolean,
  poleSouth: boolean,
  geographic: boolean,
  tms: boolean,
): Promise<{
  result: ReturnedConstructedTerrainMeshLike;
}> {
  await waitWasm();

  const mesh = constructQuantizedMeshTerrainMeshImpl(
    bytes,
    toTransferableTile(tile),
    skirt,
    skirtExaggeration,
    poleNorth,
    poleSouth,
    geographic,
    tms,
  );
  const { result, transfers } = transferReturnedConstructedTerrainMesh(mesh);
  mesh.free();
  return transfer({ result }, [...transfers]);
}
