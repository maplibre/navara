import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/layers/effect/SelectiveEffectDesc.ts",
    "web/navara_three/src/core/*SelectiveEffect*",
    "web/navara_three/src/material/selectiveEffect*",
    "web/navara_three_default_descs/src/effects/Selective*",
    "shaders/glsl/chunks/selective_effect_mask.glsl",
    "web/navara_three/src/bufferView.ts",
  ],
  lookFor:
    "Selective bloom and outline on a box, a sphere and PLATEAU Chiyoda 3D Tiles, with debug views of the MRT EffectIds (bitmask colors) and Emissive attachments: each mesh glows or outlines only when the pane assigns it that effect, and the debug views show the matching ids.",
  params: {},
  evidenceFor: [539],
} satisfies DevPageMeta;
