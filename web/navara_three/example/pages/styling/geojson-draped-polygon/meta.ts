import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/polygon*",
    "web/navara_three/src/material/enhancer/polygon/**",
    "web/navara_three/src/mesh/tile/vectorDrapeResolver.ts",
    "web/navara_three/src/mesh/DrapedMesh.ts",
    "crates/navara_geojson",
    "crates/navara_geojson_vt",
  ],
  lookFor:
    "Two GeoJSON polygons draped on GSI terrain with hillshade, colored per feature by the evaluator; they should follow the terrain without gaps or z-fighting, and Remove/Add Layer should clear and redraw them.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
