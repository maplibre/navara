import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/meshes/ArclineMeshDesc.ts",
    "web/navara_three_default_descs/src/meshes/arcLine.ts",
    "web/navara_three_default_descs/src/meshes/GlowGlobeMeshDesc.ts",
    "web/navara_three_default_descs/src/effects/SelectiveBloomEffectDesc.ts",
  ],
  lookFor:
    "Night globe with Japan airport routes as blooming arc lines whose thickness and color follow traffic volume, with dashes animating from source to destination (arcLines updated every preUpdate) and a globe glow. Needs local data that is not redistributed (see README.md): airport-traffic-volume.geojson and blue-marble-night tiles under example/public/data.",
  params: {},
  evidenceFor: [640],
} satisfies DevPageMeta;
