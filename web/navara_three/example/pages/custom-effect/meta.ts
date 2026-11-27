import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/core/EffectDesc.ts",
    "web/navara_three/src/core/EffectDescRegistry.ts",
    "web/navara_three/src/effects/effect.ts",
  ],
  lookFor:
    "A user-defined EffectDesc (a postprocessing VignetteEffect wrapped in `Effect`, registered with `registerEffect`) over a Tokyo scene: the pane's technique, offset and darkness should change the vignette live, and Reset should restore the defaults.",
  params: {},
  evidenceFor: [540],
} satisfies DevPageMeta;
