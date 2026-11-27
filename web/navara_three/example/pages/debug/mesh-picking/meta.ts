import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/pickable*",
    "web/navara_three/src/object3DEvent*",
    "web/navara_three/src/pick/**",
    "web/navara_three/src/event/**",
    "web/navara_three/src/mesh/instanced.ts",
    "shaders/glsl/chunks/pick.glsl",
  ],
  lookFor:
    "Every built-in mesh descriptor (box, sphere, cylinder, plane, tube, glTF, their instanced variants, arcline, smooth line) at its initial camera: clicking or hovering one fills the pane's Picked Info with its name and batch id, and featureEnter/featureLeave fire as the cursor crosses meshes.",
  params: {},
  evidenceFor: [520, 580],
} satisfies DevPageMeta;
