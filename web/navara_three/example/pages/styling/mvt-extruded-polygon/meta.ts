import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/polygon*",
    "web/navara_three/src/material/enhancer/polygon/**",
    "crates/navara_vector_tile",
    "crates/navara_mvt",
    "crates/navara_parser/src/mvt/**",
    "web/navara_three/src/tasks/parseMvt*",
  ],
  lookFor:
    "PLATEAU Tokyo height-control districts from MVT, extruded by their height attribute and colored and scaled per height category; the color and scale bindings should update the extrusion live.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
