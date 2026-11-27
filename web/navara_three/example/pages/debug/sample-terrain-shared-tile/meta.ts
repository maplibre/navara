import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/terrain/sampleTerrainMostDetailed.ts",
    "web/navara_three/src/terrain/**",
  ],
  lookFor:
    '`sampleTerrainMostDetailed` for 30 positions whose z15 GSI DEM tiles 404 and fall back to one shared z14 tile: "status" reads `ok`, "sampled" is 30 / 30 and the readout lists heights; a failure shows the error instead.',
  params: {},
  evidenceFor: [1029],
} satisfies DevPageMeta;
