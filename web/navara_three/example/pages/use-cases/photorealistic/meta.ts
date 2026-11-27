import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/material/enhancer/polygon/polygonWaterEnhancer/**",
    "web/navara_three/src/water/**",
    "web/navara_three/src/material/enhancer/water/**",
    "shaders/glsl/chunks/water_pars_fragment.glsl",
    "web/navara_three/src/mesh/depthPrePass.ts",
    "web/navara_three_default_descs/src/effects/clouds/**",
    "web/navara_three_default_descs/src/meshes/RainMeshDesc.ts",
    "web/navara_three_default_descs/src/effects/rainDropEffect/**",
  ],
  lookFor:
    "Saitama levee-breach flood as MVT water polygons (water: true, slabs per cell, depthPrePass) over Re:Earth terrain and buildings, under clouds, rain and rain drops; the bottom time slider re-evaluates each cell's water height per simulation step.",
  params: {},
  evidenceFor: [462, 464, 481, 654, 720, 881, 906],
} satisfies DevPageMeta;
