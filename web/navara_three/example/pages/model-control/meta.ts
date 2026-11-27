import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/example/helpers/modelControl.ts",
    "crates/navara_camera/src/follow.rs",
    "web/navara_three_default_descs/src/meshes/GLTFModelDesc.ts",
  ],
  lookFor:
    "A soldier glTF placed on GSI terrain in Chiyoda walks with WASD (up/down keys move along the surface normal), crossfading its Idle/Walk/Run clips, while the camera follows it when cameraFollow is on. Look for the model leaving the ground, rotating off the surface normal, or the follow camera jumping.",
  params: {},
  evidenceFor: [337, 341, 344, 349, 355, 381],
} satisfies DevPageMeta;
