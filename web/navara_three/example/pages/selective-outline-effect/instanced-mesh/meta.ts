import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/SelectiveOutlineEffectDesc.ts",
    "web/navara_three_default_descs/src/meshes/InstancedBoxMeshDesc.ts",
    "web/navara_three/src/core/InstancedMeshDesc.ts",
    "web/navara_three/src/core/*SelectiveEffect*",
    "web/navara_three/src/material/selectiveEffect*",
    "web/navara_three/src/layers/effect/SelectiveEffectDesc.ts",
    "shaders/glsl/chunks/selective_effect_mask.glsl",
  ],
  lookFor:
    "Only the InstancedBoxMeshDesc buildings get the green selective outline; nothing else on the map is outlined. Add 100 Buildings adds instances, which must pick up the effect too.",
  params: {},
  evidenceFor: [502],
} satisfies DevPageMeta;
