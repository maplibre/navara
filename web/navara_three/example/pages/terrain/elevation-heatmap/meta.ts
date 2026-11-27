import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/material/enhancer/tileComposite/tileElevationHeatmapEnhancer/**",
    "web/navara_three/src/colorMapAtlas*",
    "web/navara_core/src/color/ColorMap*",
    "web/navara_three/src/material/enhancer/tileComposite/**",
  ],
  lookFor:
    "An elevation heatmap raster layer from the Mapterhorn DEM over Re:Earth quantized-mesh terrain; the color map, min/max height and logarithmic bindings should recolor the surface continuously across tile boundaries.",
  params: {},
  evidenceFor: [715, 873],
} satisfies DevPageMeta;
