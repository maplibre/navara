import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/SelectiveOutlineEffectDesc.ts",
    "web/navara_three/src/material/enhancer/polyline/polylineBaseEnhancer/**",
    "web/navara_three/src/mesh/polyline.ts",
    "web/navara_three/src/event/features/polyline.ts",
    "web/navara_three/src/core/*SelectiveEffect*",
    "web/navara_three/src/material/selectiveEffect*",
    "web/navara_three/src/layers/effect/SelectiveEffectDesc.ts",
    "shaders/glsl/chunks/selective_effect_mask.glsl",
  ],
  lookFor:
    "Only the GeoJSON railway polylines get the green selective outline; nothing else on the map is outlined. The Remove/Add Layer button deletes and re-adds the layer; the effect must come back with it. The width slider changes the line width under the outline.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
