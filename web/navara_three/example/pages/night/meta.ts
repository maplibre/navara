import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/fogLight/**",
    "web/navara_three_default_descs/src/effects/FogLightEffectDesc.ts",
    "shaders/glsl/fogLight.frag.glsl",
    "web/navara_three_default_descs/src/lights/LightProbeDesc.ts",
    "web/navara_three_default_descs/src/lights/SkyLightProbeDesc.ts",
    "web/navara_three_default_descs/src/lights/skyLightProbe.ts",
    "web/navara_three_default_descs/src/meshes/StarsDesc.ts",
    "web/navara_three_default_descs/src/meshes/stars.ts",
  ],
  lookFor:
    'Tokyo at 10 PM: fog lights glow around street-light and Tokyo-point positions over PLATEAU buildings, with stars, a night light probe and a sky light probe whose intensity follows the time of day. The pane switches the 3D Tiles scene and tunes fog density, light radius, downsampling and max lights per tile; "show grid" draws the light tile grid.',
  params: {},
  evidenceFor: [248, 252, 257, 265, 343, 355],
} satisfies DevPageMeta;
