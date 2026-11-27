import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/sdfText/**",
    "shaders/glsl/sdfText*",
    "web/navara_three/src/material/enhancer/sdfText/**",
    "web/navara_font/**",
    "crates/navara_wasm_font_worker/**",
    "web/navara_three/src/declutter/**",
    "crates/navara_parser/src/line_placement.rs",
    "web/navara_three/src/mesh/sprite/**",
    "shaders/glsl/instancedSprite*",
    "web/navara_three/src/material/enhancer/instancedSprite/**",
    "crates/navara_vector_tile",
    "crates/navara_mvt",
    "crates/navara_parser/src/mvt/**",
    "web/navara_three/src/tasks/parseMvt*",
  ],
  lookFor:
    "London street names repeated along OpenFreeMap road centerlines and direction arrows turned to each road; labels should bend with the road, be dropped when they would overrun it, and declutter by road class.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
