import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/pick/pickTerrain.ts",
    "web/navara_three/src/pick/**",
  ],
  lookFor:
    "The map's canvas is offset 300 px right and 50 px down from the page origin; clicking the terrain places a sphere at the `pickTerrainPosition` result and a red ring at the click, and the sphere lands inside the ring (canvas-relative picking would miss by the offset).",
  params: {},
  evidenceFor: [1030],
} satisfies DevPageMeta;
