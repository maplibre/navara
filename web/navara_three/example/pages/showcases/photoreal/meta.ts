import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/clouds/**",
    "web/navara_three_default_descs/src/effects/aerialPerspective/**",
    "web/navara_three_default_descs/src/effects/rainDropEffect/**",
    "web/navara_three_default_descs/src/meshes/{Rain,Snow}MeshDesc.ts",
    "web/navara_worker/**",
    "crates/navara_worker*",
    "crates/navara_event*",
    "crates/navara_data_requester",
    "crates/navara_wasm/src/event/**",
    "web/navara_three/src/tasks/**",
  ],
  lookFor:
    "Preset photoreal scenes (Manhattan, Fuji/Tokyo/London clouds, Shinjuku rainy) on Google Photorealistic 3D Tiles or Mapterhorn terrain with clouds, rain, snow and aerial perspective. Switching the Scene disposes and rebuilds the view; use it for cold-load time and FPS.",
  params: {
    scene:
      "preset scene key (manhattan, fuji-clouds, tokyo-clouds, london-clouds, shinjuku-rainy); the Scene control writes it back to the URL. Defaults to the first preset",
  },
  evidenceFor: [],
} satisfies DevPageMeta;
