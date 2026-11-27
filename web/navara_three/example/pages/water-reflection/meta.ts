import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/water/**",
    "web/navara_three/src/material/enhancer/water/**",
    "web/navara_three/src/material/enhancer/polygon/polygonWaterEnhancer/**",
    "web/navara_three/src/material/enhancer/tileComposite/tileWatermaskEnhancer/**",
    "web/navara_three/src/material/enhancer/tileComposite/tileWaterEnhancer/**",
    "shaders/glsl/chunks/water_pars_fragment.glsl",
    "web/navara_three_default_descs/src/effects/ssr/**",
    "web/navara_three_default_descs/src/effects/SSREffectDesc.ts",
    "web/navara_three_default_descs/src/meshes/SkyMeshDesc.ts",
  ],
  lookFor:
    "Tokyo Bay water as an MVT or GeoJSON water polygon and as the quantized-mesh terrain's watermask sea, both shading as water with waves and SSR reflections of PLATEAU buildings. The pane switches the data type, wave strength, direction, flow speed and water scale, the sky env map and the watermask color, plus every SSR setting.",
  params: {},
  evidenceFor: [
    232, 234, 239, 240, 245, 306, 307, 365, 642, 762, 849, 906, 911,
  ],
} satisfies DevPageMeta;
