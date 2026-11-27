import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/lineDash/**",
    "web/navara_three/src/mesh/polyline*",
    "web/navara_three/src/mesh/nvLineGeometry*",
    "shaders/glsl/*olyline*",
    "web/navara_three/src/material/enhancer/polyline/**",
    "crates/navara_vector_tile",
    "crates/navara_mvt",
    "crates/navara_parser/src/mvt/**",
    "web/navara_three/src/tasks/parseMvt*",
  ],
  lookFor:
    "PLATEAU Gifu roads from MVT draped on Mapterhorn terrain: solid green where the road has street trees and dashed gray where it has none; the width binding should restyle the lines.",
  params: {},
  evidenceFor: [739],
} satisfies DevPageMeta;
