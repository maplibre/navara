import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_pmtiles",
    "crates/pmtiles",
    "crates/navara_vector_tile",
    "crates/navara_mvt",
    "crates/navara_parser/src/mvt/**",
    "web/navara_three/src/tasks/parseMvt*",
    "web/navara_worker/src/tasks/parseMvtTile.ts",
    "web/navara_three/src/mesh/sdfText/**",
    "shaders/glsl/sdfText*",
    "web/navara_three/src/declutter/**",
    "web/navara_font/**",
    "crates/navara_wasm_font_worker",
    "web/navara_three/src/mesh/sprite/**",
    "shaders/glsl/instancedSprite*",
    "web/navara_three/src/evaluations/**",
  ],
  lookFor:
    "Overture's worldwide PMTiles (land, land cover/use, water, boundaries, buildings, admin labels, POI icon + name pairs) from the current release, with viewpoint buttons, per-layer toggles through evaluators, label size and max width, and POI confidence and density. Look for slow loading, label flicker or declutter churn while zooming, and missing POI icons.",
  params: {},
  evidenceFor: [637, 672, 679, 688, 692, 717, 755],
} satisfies DevPageMeta;
