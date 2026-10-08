import type { BufferGeometry } from "three";

import { decodeDracoAsync } from "../tasks/decodeDracoAsync";

import type { DracoAttributeArrayType } from "./dracoGeometry";

/**
 * `GLTFLoader`'s `KHR_draco_mesh_compression` decoder, running on the shared
 * worker pool. GLTFLoader only calls `preload` and `decodeDracoFile`.
 */
export class DracoDecoder {
  preload(): this {
    return this;
  }

  /** glTF vertex colors are already linear, so the color space is unused. */
  decodeDracoFile(
    buffer: ArrayBuffer,
    callback: (geometry: BufferGeometry) => void,
    attributeIDs: Record<string, number>,
    attributeTypes: Record<string, DracoAttributeArrayType>,
    _vertexColorSpace?: string,
    onError?: (error: unknown) => void,
  ): Promise<void> {
    return decodeDracoAsync(buffer, { attributeIDs, attributeTypes })
      .then(callback)
      .catch(onError);
  }
}

export const DRACO_DECODER = new DracoDecoder();
