import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/SelectiveBloomEffectDesc.ts",
    "web/navara_three/src/event/features/point.ts",
    "web/navara_three/src/mesh/sprite/instancedSprite.ts",
    "web/navara_three/src/material/enhancer/instancedSprite/**",
    "crates/navara_mvt",
    "web/navara_three/src/core/*SelectiveEffect*",
    "web/navara_three/src/material/selectiveEffect*",
    "web/navara_three/src/layers/effect/SelectiveEffectDesc.ts",
    "shaders/glsl/chunks/selective_effect_mask.glsl",
  ],
  lookFor:
    "Only the PLATEAU Wakayama MVT points bloom (their effectIds name the selective bloom effect); the terrain and basemap around them stay unbloomed.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
