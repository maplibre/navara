import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/sdfText/**",
    "web/navara_three/src/material/enhancer/sdfText/**",
    "shaders/glsl/sdfText*",
    "web/navara_three/src/mesh/sprite/**",
    "web/navara_three/src/material/enhancer/instancedSprite/**",
    "shaders/glsl/instancedSprite*",
    "web/navara_three/src/declutter/**",
    "web/navara_three/src/event/features/text.ts",
    "web/navara_three/src/event/features/billboard.ts",
    "web/navara_font/**",
    "crates/navara_wasm_font_worker/**",
  ],
  lookFor:
    "One vector layer drawing text and billboards over a dense point grid, a road and a park, with a pane folder per material concern (style, orientation, placement, declutter, surface and depth, effects, layout, image): each option applies live or after a rebuild, labels pair with their billboards, and per-feature outline colors survive later material outline edits.",
  params: {},
  evidenceFor: [893, 900],
} satisfies DevPageMeta;
