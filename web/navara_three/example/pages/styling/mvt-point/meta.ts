import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/sprite/**",
    "shaders/glsl/instancedSprite*",
    "web/navara_three/src/material/enhancer/instancedSprite/**",
    "crates/navara_vector_tile",
    "crates/navara_mvt",
    "crates/navara_parser/src/mvt/**",
    "web/navara_three/src/tasks/parseMvt*",
  ],
  lookFor:
    "Heliports in Wakayama from PLATEAU MVT as ground-clamped points colored by heliport type; the size binding and Remove/Add Layer should resize or rebuild them.",
  params: {},
  evidenceFor: [444],
} satisfies DevPageMeta;
