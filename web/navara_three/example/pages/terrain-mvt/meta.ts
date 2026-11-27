import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_vector_tile",
    "crates/navara_mvt",
    "crates/navara_parser/src/mvt/**",
    "web/navara_three/src/tasks/parseMvt*",
    "web/navara_three/src/mesh/tile/**",
    "crates/navara_tile",
    "crates/navara_tile_component",
    "crates/martini",
    "crates/navara_quadtree",
    "crates/navara_source",
    "web/navara_three/src/tasks/*errain*",
    "web/navara_three/src/tasks/upsample*",
    "web/navara_worker/**",
    "crates/navara_worker*",
    "crates/navara_event*",
    "crates/navara_data_requester",
    "crates/navara_wasm/src/event/**",
    "web/navara_three/src/tasks/**",
  ],
  lookFor:
    "GSI vector tiles (water areas, buildings, contours, roads) and a GeoJSON polygon clamped to terrain, with a pane switch between quantized-mesh and raster-DEM (plus hillshade) terrain; the vector layers should re-drape onto the new surface on each switch without holes while the camera stays put.",
  params: {},
  evidenceFor: [325, 327, 342, 360, 367, 669],
} satisfies DevPageMeta;
