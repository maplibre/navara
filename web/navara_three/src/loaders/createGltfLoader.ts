import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { DRACO_DECODER } from "./DracoDecoder";

/**
 * Creates a `GLTFLoader` that decodes Draco and meshopt compressed geometry.
 * Draco runs on Navara's worker pool, so `ThreeView` must be initialized.
 */
export function createGltfLoader(): GLTFLoader {
  return (
    new GLTFLoader()
      // GLTFLoader only calls `preload` and `decodeDracoFile`.
      .setDRACOLoader(DRACO_DECODER as unknown as DRACOLoader)
      .setMeshoptDecoder(MeshoptDecoder)
  );
}
