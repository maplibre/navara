import { ReturnedConstructedTerrainMeshLike } from "@navaramap/core";
import type { ReturnedConstructedTerrainMesh } from "@navaramap/engine-worker";

export function transferReturnedConstructedTerrainMesh(
  r: ReturnedConstructedTerrainMesh,
) {
  const like = new ReturnedConstructedTerrainMeshLike(r);
  const transfers: ArrayBufferLike[] = [
    like.vertices.buffer,
    like.uvs.buffer,
    like.indices.buffer,
    like.heights.buffer,
  ];
  if (like.normals) transfers.push(like.normals.buffer);
  if (like.skirt_vertices) transfers.push(like.skirt_vertices.buffer);
  if (like.skirt_uvs) transfers.push(like.skirt_uvs.buffer);
  if (like.skirt_indices) transfers.push(like.skirt_indices.buffer);
  if (like.skirt_normals) transfers.push(like.skirt_normals.buffer);
  if (like.skirt_heights) transfers.push(like.skirt_heights.buffer);
  if (like.watermask) transfers.push(like.watermask.buffer);
  return { result: like, transfers };
}
