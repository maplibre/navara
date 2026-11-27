import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_cesium3dtiles",
    "web/navara_three/src/plugins/AttributionPlugin/**",
    "web/navara_three/src/mesh/model*",
  ],
  lookFor:
    "Google Photorealistic 3D Tiles (maxSse 30; needs the Google Maps key in helpers/keys.ts) stream in and refine as the camera moves, and the attribution lists the tiles' copyright credits nested under the Google entry. Look for tiles that never refine, holes, or credits that do not follow the view.",
  params: {},
  evidenceFor: [344, 403, 557, 636],
} satisfies DevPageMeta;
