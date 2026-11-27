import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_tile/src/tile/system.rs",
    "web/navara_three/src/mesh/tile/index.ts",
    "crates/navara_layer/src/terrain.rs",
  ],
  lookFor:
    "Google Photorealistic 3D Tiles with a hidden quantized-mesh terrain (`terrain.show: false`) whose heights still clamp the red points; toggling terrain should show or hide its mesh while the points stay on the ground, and the clamp toggle drops them to the ellipsoid.",
  params: {},
  evidenceFor: [960],
} satisfies DevPageMeta;
