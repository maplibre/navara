import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: ["web/navara_three/example/helpers/sh.ts"],
  lookFor:
    "A tool, not an engine check: choose an equirectangular EXR and the page prints its spherical-harmonics coefficients (three's LightProbeGenerator) in the format of helpers/sh.ts, with a copy button.",
  params: {},
  evidenceFor: [248, 539],
} satisfies DevPageMeta;
