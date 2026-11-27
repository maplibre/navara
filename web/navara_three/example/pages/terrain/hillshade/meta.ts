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
    "A hillshade raster layer from the Mapterhorn DEM over its terrain and OpenStreetMap; enable should add or remove the hillshade layer and exaggeration should deepen the shading without seams between tiles.",
  params: {},
  evidenceFor: [607],
} satisfies DevPageMeta;
