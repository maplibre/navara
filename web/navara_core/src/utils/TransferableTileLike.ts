import type {
  CachedMeshHandle,
  TileXYZ,
  TransferableTile,
} from "@navaramap/engine";

import type { RemoveFreeRecursively } from "../types";

export class TransferableTileLike {
  cached_mesh_handle?: CachedMeshHandleLike | undefined;
  coords: TileXYZLike;
  max_height: number;
  min_height: number;

  constructor(t: TransferableTile) {
    // Both getters hand out owned wasm objects: read each once, copy, free.
    const cachedMeshHandle = t.cached_mesh_handle;
    this.cached_mesh_handle = cachedMeshHandle
      ? new CachedMeshHandleLike(cachedMeshHandle)
      : undefined;
    cachedMeshHandle?.free();
    const coords = t.coords;
    this.coords = new TileXYZLike(coords);
    coords.free();
    this.max_height = t.max_height;
    this.min_height = t.min_height;
  }

  free(): void {}
}

export class TileXYZLike implements RemoveFreeRecursively<TileXYZ> {
  x: number;
  y: number;
  z: number;

  constructor(t: TileXYZ) {
    this.x = t.x;
    this.y = t.y;
    this.z = t.z;
  }
}

export class CachedMeshHandleLike {
  vertices: number;
  uvs: number;
  indices: number;
  heights?: number | undefined;
  normals?: number | undefined;
  watermask?: number | undefined;

  constructor(t: CachedMeshHandle) {
    this.vertices = t.vertices;
    this.uvs = t.uvs;
    this.indices = t.indices;
    this.heights = t.heights;
    this.normals = t.normals;
    this.watermask = t.watermask;
  }

  free(): void {}
}
