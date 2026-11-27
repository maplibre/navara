import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/fogLight/**",
    "web/navara_three_default_descs/src/effects/FogLightEffectDesc.ts",
    "web/navara_three/src/evaluations/**",
  ],
  lookFor:
    "The fixed-camera Marunouchi scene captured for the landing page's API-tier stills (no UI): scene 1 white-model buildings on terrain, 2 the photoreal atmosphere, 3 buildings colored by height through `featureUpdated`, 4 the city at night lit by FogLightEffectDesc street lamps; each scene should settle to the same framing every load.",
  params: {
    scene: "1 to 4: which look to render (default 4)",
  },
  evidenceFor: [],
} satisfies DevPageMeta;
