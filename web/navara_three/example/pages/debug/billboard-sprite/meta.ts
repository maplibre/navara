import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/sprite/**",
    "shaders/glsl/instancedSprite.*",
    "web/navara_three/src/event/features/billboard.ts",
  ],
  lookFor:
    "Billboards drawn from a sprite sheet: icons at their natural size, a gap where an icon name is not in the sprite, and SDF icons in their color with round halos. The panel switches `sprite`, the default `icon`, the halo fields and the pixel ratio live.",
  params: {},
  evidenceFor: [1009],
} satisfies DevPageMeta;
