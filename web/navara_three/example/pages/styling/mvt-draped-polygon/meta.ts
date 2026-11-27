import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/polygon*",
    "web/navara_three/src/material/enhancer/polygon/**",
    "web/navara_three/src/mesh/tile/vectorDrapeResolver.ts",
    "web/navara_three/src/mesh/DrapedMesh.ts",
    "crates/navara_vector_tile",
    "crates/navara_mvt",
    "crates/navara_parser/src/mvt/**",
    "web/navara_three/src/tasks/parseMvt*",
  ],
  lookFor:
    "PLATEAU Tokyo fire-prevention districts from MVT draped on GSI terrain, colored by district type; the color bindings should restyle them and Remove/Add Layer should rebuild the tiles.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
