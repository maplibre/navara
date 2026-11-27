import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/**/*illshade*",
    "crates/navara_tile/src/hillshade",
    "shaders/glsl/chunks/hillshade*",
    "web/navara_three/src/tileTexture/**",
    "web/navara_three/src/material/enhancer/tileComposite/**",
    "web/navara_three/src/material/macro/tileShader*",
  ],
  lookFor:
    "A hillshade raster layer from the Mapterhorn DEM with no terrain layer, so the globe stays at the ellipsoid; the shading should still render over the OpenStreetMap base, and exaggeration should change it live.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
