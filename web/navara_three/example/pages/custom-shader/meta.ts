import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/material/overrideMaterialsForMRT.ts",
    "web/navara_three/src/core/MeshDesc.ts",
    "web/navara_three/src/core/MeshDescRegistry.ts",
  ],
  lookFor:
    "A user-defined MeshDesc (three-stdlib MarchingCubes with a toon hatching ShaderMaterial, `setupMaterialForMRT` and an MRT pass key) placed above Tokyo on GSI terrain: the blobs should animate, receive the default scene's effects through their G-buffer normals, and not be shaded through by depth/normal-based effects.",
  params: {},
  evidenceFor: [520, 540, 708, 765],
} satisfies DevPageMeta;
