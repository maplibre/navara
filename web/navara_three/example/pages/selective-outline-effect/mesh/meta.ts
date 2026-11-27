import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/SelectiveOutlineEffectDesc.ts",
    "web/navara_three_default_descs/src/meshes/{Box,Sphere,Cylinder,Plane,Tube}MeshDesc.ts",
    "web/navara_three/src/core/*SelectiveEffect*",
    "web/navara_three/src/material/selectiveEffect*",
    "web/navara_three/src/layers/effect/SelectiveEffectDesc.ts",
    "shaders/glsl/chunks/selective_effect_mask.glsl",
  ],
  lookFor:
    "Only the box, sphere, cylinder, plane and tube mesh descriptors (transparent at opacity 1) get the green selective outline; nothing else on the map is outlined.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
