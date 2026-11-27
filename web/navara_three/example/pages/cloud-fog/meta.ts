import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/effects/clouds/**",
    "web/navara_three_default_descs/src/effects/CloudsEffectDesc.ts",
  ],
  lookFor:
    "Ground fog made from CloudsEffectDesc's lowest cloud layer (altitude 0, constant density, through `ref.raw`) over GSI terrain and PLATEAU buildings in Tokyo, with cloud shadows on: the fog should hug the ground up to the pane's height and thin out with its density.",
  params: {},
  evidenceFor: [198],
} satisfies DevPageMeta;
