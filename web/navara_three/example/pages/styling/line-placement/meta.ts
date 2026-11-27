import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_parser/src/line_placement.rs",
    "web/navara_three/src/mesh/sdfText/linePlacement*",
    "crates/navara_wasm_api/src/line_label.rs",
    "web/navara_three/src/mesh/sdfText/**",
    "web/navara_three/src/mesh/sprite/**",
    "shaders/glsl/sdfText*",
  ],
  lookFor:
    'Text and arrow sprites placed along generated curves with `placement: "line"`; anchors should thin out and fill in with zoom without moving, labels bend with the curve (keepUpright, maxAngle, spreadGlyphs), and clicking a label turns every label of its line green.',
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
