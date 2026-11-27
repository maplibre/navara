import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: ["web/navara_three/src/atmosphere*"],
  lookFor:
    "`view.atmosphere.setDateFromCameraAt` and `setElevationFromCameraAt` move the camera between five cities while keeping the local solar time or the sun elevation: the info pane's solar time or elevation (checked against astronomy-engine) should stay the same after each jump, and the terrain lighting should match.",
  params: {},
  evidenceFor: [608],
} satisfies DevPageMeta;
