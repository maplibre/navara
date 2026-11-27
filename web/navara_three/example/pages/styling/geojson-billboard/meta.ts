import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/event/features/billboard.ts",
    "web/navara_three/src/mesh/sprite/**",
    "shaders/glsl/instancedSprite*",
    "web/navara_three/src/material/enhancer/instancedSprite/**",
    "crates/navara_geojson",
    "crates/navara_geojson_vt",
  ],
  lookFor:
    "Screen-sized image billboards for the railway time-series GeoJSON clamped to GSI terrain, red where `N05_005e` is 9999 and white elsewhere; the size binding and Remove/Add Layer should resize or rebuild them.",
  params: {},
  evidenceFor: [444, 816],
} satisfies DevPageMeta;
