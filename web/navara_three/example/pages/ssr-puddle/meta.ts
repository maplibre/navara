import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/ssr/**",
    "web/navara_three_default_descs/src/effects/SSREffectDesc.ts",
    "shaders/glsl/ssr*",
    "web/navara_three/src/material/gbufferLayout*",
    "web/navara_three/src/material/overrideMaterialsForMRT*",
    "web/navara_three/src/passes/**",
    "web/navara_three/src/orchestrators/**",
    "web/navara_three/src/layers/effect/**",
  ],
  lookFor:
    "A custom MRT pass writes puddles into the geometry buffer that SSREffectDesc reads (its geometryBuffer option), so the Marunouchi buildings reflect in puddles on the ground; the pane toggles the custom buffer (off returns SSR to the engine's MRT normal buffer) and sets puddle radius, wetness and roughness.",
  params: {},
  evidenceFor: [735, 776, 926, 992],
} satisfies DevPageMeta;
