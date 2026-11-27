import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/aerialPerspective/**",
    "web/navara_three_default_descs/src/effects/AerialPerspectiveEffectDesc.ts",
    "shaders/glsl/aerialPerspective*",
    "shaders/glsl/chunks/screen_space_shadow_filter.glsl",
    "web/navara_three_default_descs/src/lights/**",
    "web/navara_three/src/atmosphere*",
    "web/navara_three_default_descs/src/meshes/SkyMeshDesc.ts",
    "web/navara_three_default_descs/src/meshes/skyMesh.ts",
    "web/navara_three_default_descs/src/effects/clouds/**",
  ],
  lookFor:
    "Buildings, terrain and known boxes and spheres lit by the AerialPerspectiveEffect's deferred terms: the screen-space shadow (intensity, softness, samples) and the specular highlight follow the pane, and cloud shadows dim both the highlight and the shadowed ground.",
  params: {},
  evidenceFor: [838],
} satisfies DevPageMeta;
