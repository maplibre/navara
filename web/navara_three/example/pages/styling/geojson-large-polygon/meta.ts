import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/polygon*",
    "web/navara_three/src/material/enhancer/polygon/**",
    "crates/navara_geojson",
    "crates/navara_geojson_vt",
  ],
  lookFor:
    "The large Tokyo flood-depth GeoJSON as tiled (`tiled: true`) polygons extruded by flood rank; tiles should load without holes or duplicated features, and outlineShow should toggle the magenta outlines.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
