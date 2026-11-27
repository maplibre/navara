import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_plugins/src/PersonViewPlugin.ts",
    "crates/navara_camera",
    "crates/navara_input",
    "web/navara_three/src/camera*",
    "web/navara_three/src/input*",
  ],
  lookFor:
    "A tool for authoring camera shots over Mapterhorn or Google Photorealistic 3D Tiles: switch between the free orbit camera and PersonViewPlugin (TPV/FPV character), jump between city presets, toggle clouds/rain/snow, and copy or paste the camera as a JS object; the pasted state should reproduce the same view, and switching the base layer should keep the camera position.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
