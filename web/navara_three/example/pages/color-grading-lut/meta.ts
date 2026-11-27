import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/colorGradingLUT.ts",
    "web/navara_three_default_descs/src/effects/ColorGradingLUTEffectDesc.ts",
  ],
  lookFor:
    "ColorGradingLUTEffectDesc over a Tokyo scene (GSI photo, terrain, PLATEAU buildings): pick a LUT, a blend mode and an opacity in the pane; the grade should change the whole frame, and hiding the effect should restore the ungraded image.",
  params: {},
  evidenceFor: [372],
} satisfies DevPageMeta;
