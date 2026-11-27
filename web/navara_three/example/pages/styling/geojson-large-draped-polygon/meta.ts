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
    "A large Tokyo flood-depth GeoJSON draped on GSI terrain, colored per flood rank; it should tile and drape without missing or seamed tiles, and Remove/Add Layer should release and redraw it.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
