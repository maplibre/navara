import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/meshes/ArclineMeshDesc.ts",
    "web/navara_three_default_descs/src/meshes/arcLine.ts",
    "shaders/glsl/arcLine*",
  ],
  lookFor:
    "One ArclineMeshDesc arc from Tokyo to a point a pane-set distance away: as the distance sweeps down to sub-meter separations the arc stays a smooth curve with its lift, without collapsing, flipping or exploding.",
  params: {},
  evidenceFor: [737],
} satisfies DevPageMeta;
