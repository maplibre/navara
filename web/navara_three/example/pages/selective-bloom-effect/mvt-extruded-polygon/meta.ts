import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/SelectiveBloomEffectDesc.ts",
    "web/navara_three/src/material/enhancer/polygon/polygonBaseEnhancer/**",
    "web/navara_three/src/mesh/polygon.ts",
    "web/navara_three/src/event/features/polygon.ts",
    "crates/navara_mvt",
    "web/navara_three/src/core/*SelectiveEffect*",
    "web/navara_three/src/material/selectiveEffect*",
    "web/navara_three/src/layers/effect/SelectiveEffectDesc.ts",
    "shaders/glsl/chunks/selective_effect_mask.glsl",
  ],
  lookFor:
    "Only the extruded PLATEAU height-control MVT polygons bloom (their effectIds name the selective bloom effect); the terrain and basemap around them stay unbloomed.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
