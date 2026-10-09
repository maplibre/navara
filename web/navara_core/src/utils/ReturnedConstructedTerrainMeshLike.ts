import type { ReturnedConstructedTerrainMesh } from "@navaramap/engine";

import type { RemoveFreeRecursively } from "../types";

import { Vec3Like } from "./Vec3Like";

export class ReturnedConstructedTerrainMeshLike implements RemoveFreeRecursively<ReturnedConstructedTerrainMesh> {
  vertices: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  heights: Float32Array;
  max_height: number;
  min_height: number;
  rtc_translation: Vec3Like | undefined;
  normals: Float32Array | undefined;
  skirt_vertices: Float32Array | undefined;
  skirt_uvs: Float32Array | undefined;
  skirt_indices: Uint32Array | undefined;
  skirt_normals: Float32Array | undefined;
  skirt_heights: Float32Array | undefined;
  watermask: Uint8Array | undefined;

  // The transfer* methods return arrays copied out of WASM memory (owned by
  // JS, backed by their own ArrayBuffer), so they are retained and transferred
  // as-is — a further copy (`.slice()`) would be redundant.
  constructor(t: ReturnedConstructedTerrainMesh) {
    this.vertices = t.transferVertices();
    this.uvs = t.transferUvs();
    this.indices = t.transferIndices();
    this.heights = t.transferHeights();
    this.max_height = t.max_height;
    this.min_height = t.min_height;
    this.rtc_translation = t.rtc_translation
      ? new Vec3Like(t.rtc_translation)
      : undefined;
    if (t.hasNormals()) {
      this.normals = t.transferNormals();
    }
    if (t.hasSkirt()) {
      this.skirt_vertices = t.transferSkirtVertices();
      this.skirt_uvs = t.transferSkirtUvs();
      this.skirt_indices = t.transferSkirtIndices();
      this.skirt_normals = t.transferSkirtNormals();
      this.skirt_heights = t.transferSkirtHeights();
    }
    if (t.hasWatermask()) {
      this.watermask = t.transferWatermask();
    }
  }

  transferVertices(): Float32Array {
    throw new Error();
  }
  transferUvs(): Float32Array {
    throw new Error();
  }
  transferIndices(): Uint32Array {
    throw new Error();
  }
  transferHeights(): Float32Array {
    throw new Error();
  }
  transferNormals(): Float32Array | undefined {
    throw new Error();
  }
  transferSkirtVertices(): Float32Array | undefined {
    throw new Error();
  }
  transferSkirtUvs(): Float32Array | undefined {
    throw new Error();
  }
  transferSkirtIndices(): Uint32Array | undefined {
    throw new Error();
  }
  transferSkirtNormals(): Float32Array | undefined {
    throw new Error();
  }
  transferSkirtHeights(): Float32Array | undefined {
    throw new Error();
  }
  transferWatermask(): Uint8Array | undefined {
    throw new Error();
  }
  hasSkirt(): boolean {
    return (
      this.skirt_vertices !== undefined &&
      this.skirt_uvs !== undefined &&
      this.skirt_indices !== undefined
    );
  }
  hasNormals(): boolean {
    return this.normals !== undefined;
  }
  hasWatermask(): boolean {
    return this.watermask !== undefined;
  }
}
