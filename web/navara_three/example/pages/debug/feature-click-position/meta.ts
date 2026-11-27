import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/index.ts",
    "web/navara_three/src/pick/pickHelper.ts",
    "web/navara_three/src/pick/pickTerrain.ts",
    "web/navara_three/src/utils/screen.ts",
  ],
  lookFor:
    "Clicking a roof drops a sphere at `pickDepthPosition(event.clientX, event.clientY)` inside the red ring at the click, and the featureClick readout shows the event with `map` on the ellipsoid (height 0) and the drawn point on the roof; hovering another building updates the featureHover readout's feature id, `pointermove` and `map`.",
  params: {},
  evidenceFor: [1023, 1036],
} satisfies DevPageMeta;
