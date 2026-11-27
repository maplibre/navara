import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: ["web/navara_three_default_descs/src/meshes/GLTFModelDesc.ts"],
  lookFor:
    "GLTFModelDesc animation: a model in Sapporo blends its Idle/Walk/Run clips by the pane's weights (crossfade, speed, loop, play/pause, after `animationReady`), and a running model circles the globe along Osaka's latitude, re-oriented every frame; the clips should blend smoothly and the runner should stay upright on the surface.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
