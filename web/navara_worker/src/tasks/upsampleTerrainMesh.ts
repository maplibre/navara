import {
  ReturnedConstructedTerrainMeshLike,
  TransferableRasterDEMDataLike,
  TransferableTileLike,
} from "@navaramap/core";
import { upsampleTerrainMesh as upsampleTerrainMeshImpl } from "@navaramap/engine-worker";

import { transfer } from "..";
import { transferReturnedConstructedTerrainMesh } from "../helpers/transferReturnedConstructedTerrainMesh";
import { toTransferableTile } from "../utils";
import { toTransferableRasterDEMDataLike } from "../utils/toTransferableRasterDEMDataLike";

import { waitWasm } from "./waitWasm";

/**
 * Upsample a raster-DEM tile from a real-DEM ancestor's pixels, resampled
 * down to the tile and meshed at the tile's own level, like a
 * lower-resolution real tile.
 */
export async function upsampleTerrainMesh(
  tile: TransferableTileLike,
  sourceTile: TransferableTileLike,
  rasterDEMData: TransferableRasterDEMDataLike,
  sourceBytes: Uint8Array,
  size: number,
  skirt: boolean,
  skirtExaggeration: number,
  poleNorth: boolean,
  poleSouth: boolean,
  tms: boolean,
): Promise<ReturnedConstructedTerrainMeshLike> {
  await waitWasm();

  const mesh = upsampleTerrainMeshImpl(
    toTransferableTile(tile),
    toTransferableTile(sourceTile),
    toTransferableRasterDEMDataLike(rasterDEMData),
    sourceBytes,
    size + 1,
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
