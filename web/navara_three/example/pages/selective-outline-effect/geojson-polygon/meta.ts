import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/SelectiveOutlineEffectDesc.ts",
    "web/navara_three/src/material/enhancer/polygon/polygonBaseEnhancer/**",
    "web/navara_three/src/mesh/polygon.ts",
    "web/navara_three/src/event/features/polygon.ts",
    "web/navara_three/src/core/*SelectiveEffect*",
    "web/navara_three/src/material/selectiveEffect*",
    "web/navara_three/src/layers/effect/SelectiveEffectDesc.ts",
    "shaders/glsl/chunks/selective_effect_mask.glsl",
  ],
  lookFor:
    "Only the extruded GeoJSON polygons get the green selective outline; nothing else on the map is outlined.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
