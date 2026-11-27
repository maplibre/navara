import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: ["web/navara_three_default_descs/src/meshes/SplatMeshDesc/**"],
  lookFor:
    'Gaussian splats placed at geodetic positions around Tokyo Station and one about 1800 km east; "Fly to" frames each, and its scale slider re-places it without a reload. A splat should stay at its intended lat/lng/height without jitter at either site (the dynamic RTC origin); high scales show sort boiling.',
  params: {},
  evidenceFor: [576, 666, 784],
} satisfies DevPageMeta;
