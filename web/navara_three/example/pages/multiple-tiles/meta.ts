import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/tileTexture/**",
    "web/navara_three/src/mesh/tile/rasterDrapeResolver*",
    "web/navara_three/src/material/enhancer/tileComposite/compose*",
    "web/navara_three/src/tasks/*uantizedMesh*",
  ],
  lookFor:
    "Three raster layers (OpenStreetMap, GSI standard, GSI seamless photo) composited on one quantized-mesh terrain, each with show, color and opacity in the pane. Look for the wrong stacking order, a layer's opacity or color not applying, or seams between tiles.",
  params: {},
  evidenceFor: [142, 715],
} satisfies DevPageMeta;
