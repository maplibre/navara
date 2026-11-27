import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_csm/**",
    "web/navara_three/src/material/shadowDepthMaterial.ts",
    "web/navara_three/src/ShadowMapViewers.ts",
    "web/navara_three_default_descs/src/effects/ssr/**",
    "web/navara_three_default_descs/src/effects/clouds/**",
  ],
  lookFor:
    "The photoreal scene with sun shadows rendered with `view.lit` off (default) or on (`?lit=1`), in three shots: SSR on PLATEAU buildings, water at dusk, or cloud shadows patching the city at noon; compare the two lighting paths shot by shot.",
  params: {
    lit: "`1` sets `view.lit = true`; otherwise the deferred (unlit) path",
    m: "shot: ssr (default) | water | anything else for the cloud-shadow shot",
    exp: "toneMappingExposure (default 6)",
  },
  evidenceFor: [],
} satisfies DevPageMeta;
