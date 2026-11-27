import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/polygon*",
    "web/navara_three/src/material/enhancer/polygon/**",
    "crates/navara_geojson",
  ],
  lookFor:
    "Extruded interior-floor polygons from a local GeoJSON whose height, extrudedHeight and color come from feature properties; the outlineShow toggle should show or hide the magenta outlines without rebuilding.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
