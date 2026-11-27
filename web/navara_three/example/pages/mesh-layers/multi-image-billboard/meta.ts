import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/sprite/billboardAtlas*",
    "web/navara_three/src/mesh/sprite/**",
    "web/navara_three/src/event/features/billboard.ts",
    "web/navara_three/src/material/enhancer/instancedSprite/**",
    "shaders/glsl/instancedSprite*",
  ],
  lookFor:
    "A grid of 100 to 40,000 billboards whose per-feature images and sizes come from the FeatureEvaluator (pool size, mode, including a broken image URL): every feature shows its image, clicking one toggles it back to the material's default `url` and again to its own, and removing and re-adding the layer works.",
  params: {},
  evidenceFor: [690],
} satisfies DevPageMeta;
