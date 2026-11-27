import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/pickableMesh.ts",
    "web/navara_three/src/pick/pickHelper.ts",
    "web/navara_three/src/core/MeshDesc.ts",
    "web/navara_three/src/material/overrideMaterialsForMRT.ts",
  ],
  lookFor:
    "A custom MeshDesc (torus knots) that implements `PickableMesh` by hand and writes its own picking branch into its fragment shader: clicking or hovering a knot reports its batch id, and the knots render into the MRT G-buffers like built-in meshes.",
  params: {},
  evidenceFor: [520, 708],
} satisfies DevPageMeta;
