import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/sprite/billboardAtlas*",
    "web/navara_three/src/mesh/sprite/**",
    "web/navara_three/src/event/features/billboard.ts",
  ],
  lookFor:
    "A billboard layer with no material `url`, every image set by the FeatureEvaluator: blue and orange pins appear, and the two features without an `icon` draw nothing, not a stray quad sampling the atlas.",
  params: {},
  evidenceFor: [794],
} satisfies DevPageMeta;
