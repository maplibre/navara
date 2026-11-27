import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/aerialPerspective/**",
    "web/navara_three_default_descs/src/effects/AerialPerspectiveEffectDesc.ts",
    "web/navara_three_default_descs/src/effects/clouds/**",
    "web/navara_three_default_descs/src/effects/CloudsEffectDesc.ts",
    "shaders/glsl/aerialPerspective*",
    "web/navara_three_default_descs/src/meshes/skyMesh.ts",
    "web/navara_three_default_descs/src/meshes/SkyMeshDesc.ts",
    "web/navara_three_default_descs/src/meshes/stars.ts",
    "web/navara_three_default_descs/src/meshes/StarsDesc.ts",
    "web/navara_three_default_descs/src/lights/**",
    "web/navara_three/src/atmosphere*",
    "web/navara_three_default_descs/src/effects/SSAOEffectDesc.ts",
    "web/navara_three_default_descs/src/effects/ssao.ts",
    "web/navara_three_default_descs/src/effects/toneMapping.ts",
    "web/navara_three_default_descs/src/effects/lensFlare.ts",
  ],
  lookFor:
    "The full photoreal scene over Tokyo (quantized-mesh terrain, PLATEAU buildings, clouds, sky, stars, sun and sky-light probe) with panes for every atmosphere, clouds, antialias, image-based lighting and effect parameter: the sky, aerial perspective and cloud shadows should stay consistent while you change the date and the parameters.",
  params: {},
  evidenceFor: [
    180, 181, 184, 188, 189, 193, 198, 200, 203, 205, 240, 315, 343, 348, 640,
    715, 925,
  ],
} satisfies DevPageMeta;
