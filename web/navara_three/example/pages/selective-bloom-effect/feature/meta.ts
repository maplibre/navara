import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/SelectiveBloomEffectDesc.ts",
    "web/navara_three/src/core/*SelectiveEffect*",
    "web/navara_three/src/material/selectiveEffect*",
    "web/navara_three/src/layers/effect/SelectiveEffectDesc.ts",
    "shaders/glsl/chunks/selective_effect_mask.glsl",
    "web/navara_three/src/evaluations/**",
    "web/navara_three/src/batchTexture/**",
    "shaders/glsl/chunks/batch_texture*",
    "web/navara_three/src/material/enhancer/sdfText/**",
  ],
  lookFor:
    "Per-feature emissive from the evaluator drives the bloom: PLATEAU Chiyoda/Chuo buildings glow brighter with bldg:measuredHeight, and of the three labels TOKYO glows most, NIHONBASHI less and MARUNOUCHI not at all, with only the glyph fill blooming (outline and background stay dark).",
  params: {},
  evidenceFor: [813, 816],
} satisfies DevPageMeta;
