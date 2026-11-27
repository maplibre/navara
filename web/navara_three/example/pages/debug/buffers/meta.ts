import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/material/gbufferLayout.ts",
    "web/navara_three/src/material/overrideMaterialsForMRT.ts",
    "web/navara_three/src/orchestrators/**",
    "web/navara_three/src/passes/**",
    "web/navara_three/src/layers/effect/**",
    "shaders/glsl/chunks/gbuffer_pars_fragment.glsl",
    "web/navara_three_default_descs/src/effects/ssr/**",
    "web/navara_three_default_descs/src/effects/SSREffectDesc.ts",
    "web/navara_three_default_descs/src/effects/ssao.ts",
    "web/navara_three_default_descs/src/effects/SSAOEffectDesc.ts",
  ],
  lookFor:
    "Toggling bloom, outline, a shadow-debug effect, a custom deferred-lighting effect and `lit` allocates only the G-buffers those effects request: the read-only `buffers` field lists them, and each effect renders correctly on the box and sphere.",
  params: {},
  evidenceFor: [765],
} satisfies DevPageMeta;
