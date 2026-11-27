import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/SelectiveOutlineEffectDesc.ts",
    "web/navara_three/src/event/features/point.ts",
    "web/navara_three/src/mesh/sprite/instancedSprite.ts",
    "web/navara_three/src/material/enhancer/instancedSprite/**",
    "web/navara_three/src/core/*SelectiveEffect*",
    "web/navara_three/src/material/selectiveEffect*",
    "web/navara_three/src/layers/effect/SelectiveEffectDesc.ts",
    "shaders/glsl/chunks/selective_effect_mask.glsl",
  ],
  lookFor:
    "Only the GeoJSON points at Odaiba get the red selective outline; nothing else on the map is outlined.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
