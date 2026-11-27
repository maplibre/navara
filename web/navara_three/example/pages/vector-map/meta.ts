import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_vector_tile",
    "crates/navara_mvt",
    "crates/navara_parser/src/mvt/**",
    "web/navara_three/src/tasks/parseMvt*",
    "web/navara_worker/src/tasks/parseMvtTile.ts",
    "web/navara_three/src/mesh/tile/vectorDrapeResolver*",
  ],
  lookFor:
    "GSI experimental vector tiles drawn as screen-size red points, dark lines and blue polygons clamped to GSI terrain with hillshade, with no pane. Look for tiles that never load and features that do not drape onto the terrain.",
  params: {},
  evidenceFor: [115, 116, 125, 143, 145, 156, 319, 327, 457, 496],
} satisfies DevPageMeta;
