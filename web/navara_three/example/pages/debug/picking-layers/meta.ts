import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/pick/**",
    "web/navara_three/src/mesh/pickable*",
    "web/navara_three/src/object3DEvent*",
    "web/navara_three/src/event/**",
    "web/navara_three/src/mesh/tile/vectorDrapeResolver.ts",
    "web/navara_three/src/mesh/model*",
    "shaders/glsl/chunks/pick.glsl",
  ],
  lookFor:
    'Draped polygons (picked through the tile drape atlas), extruded polygons, points and a box mesh at the initial camera: hovering highlights the feature and fills the Hover folder (layer, batch id, enter/leave counts), clicking sets "clicked", and turning hover off stops hover pick renders.',
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
