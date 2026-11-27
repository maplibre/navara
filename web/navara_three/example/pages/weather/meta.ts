import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/meshes/RainMeshDesc.ts",
    "web/navara_three_default_descs/src/meshes/rain.ts",
    "shaders/glsl/rain.*",
    "web/navara_three_default_descs/src/meshes/SnowMeshDesc.ts",
    "web/navara_three_default_descs/src/meshes/snow.ts",
    "web/navara_three_default_descs/src/effects/rainDropEffect/**",
    "web/navara_three_default_descs/src/effects/clouds/**",
    "web/navara_three_default_descs/src/effects/CloudsEffectDesc.ts",
  ],
  lookFor:
    "The weather selector switches between sunny, rainy (rain particles plus lens drops) and snowy over Tokyo with volumetric clouds, SSR and water areas; the Rain, Snow and Rain Drop Effect folders tune each live. Look for particles that do not follow the camera, or rain and snow shown together.",
  params: {},
  evidenceFor: [222, 226, 236, 239, 240, 245, 264, 306, 365, 720, 906],
} satisfies DevPageMeta;
