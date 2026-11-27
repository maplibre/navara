import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/sdfText/**",
    "shaders/glsl/sdfText*",
    "web/navara_three/src/material/enhancer/sdfText/**",
    "web/navara_font/**",
    "crates/navara_wasm_font_worker/**",
    "web/navara_three/src/declutter/**",
    "crates/navara_vector_tile",
    "crates/navara_mvt",
    "crates/navara_parser/src/mvt/**",
    "web/navara_three/src/tasks/parseMvt*",
  ],
  lookFor:
    "GSI vector-tile place-name symbols as text labels over Japan, filtered by feature code and deduplicated by the evaluator; overlapping labels declutter by priority, so bigger settlements should win.",
  params: {},
  evidenceFor: [464, 717],
} satisfies DevPageMeta;
