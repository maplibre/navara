import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/rainDropEffect/**",
    "web/navara_three_default_descs/src/effects/RainDropEffectDesc.ts",
    "shaders/glsl/rainDropEffect.frag.glsl",
  ],
  lookFor:
    "Animated rain drops on the lens refract a photoreal scene over GSI imagery; every slider (opacity, grid size, density, layers, size, noise, refraction and the advanced fade/jitter terms) updates the effect live and Reset restores the defaults.",
  params: {},
  evidenceFor: [264],
} satisfies DevPageMeta;
