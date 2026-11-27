import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/depthOfField.ts",
    "web/navara_three_default_descs/src/effects/DepthOfFieldEffectDesc.ts",
  ],
  lookFor:
    "DepthOfFieldEffectDesc over a 3D Tiles city: change the bokeh scale, focus distance and focal length in the pane; the in-focus band should move with the focus distance and the rest should blur, and Reset should restore the defaults.",
  params: {},
  evidenceFor: [314, 430],
} satisfies DevPageMeta;
