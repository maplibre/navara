import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/lineDash/**",
    "web/navara_three/src/mesh/polyline*",
    "web/navara_three/src/mesh/nvLineGeometry*",
    "shaders/glsl/*olyline*",
    "web/navara_three/src/material/enhancer/polyline/**",
    "crates/navara_geojson",
    "crates/navara_geojson_vt",
  ],
  lookFor:
    "Japanese railways as GeoJSON polylines colored by railway class; width, maxWidth, dash patterns and caps should apply live, and the clampToGround toggle rebuilds them as draped lines or 3D-scene lines.",
  params: {},
  evidenceFor: [450, 547],
} satisfies DevPageMeta;
