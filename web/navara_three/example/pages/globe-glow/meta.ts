import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/meshes/GlowGlobeMeshDesc.ts",
    "shaders/glsl/glowGlobe*",
  ],
  lookFor:
    "GlowGlobeMeshDesc around the whole globe (ambient light only, no atmosphere): the halo should follow the pane's radius scale, coefficient, exponent, color and opacity, and Delete Descriptor should remove it cleanly.",
  params: {},
  evidenceFor: [335, 374],
} satisfies DevPageMeta;
