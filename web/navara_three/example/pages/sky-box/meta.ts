import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/meshes/SkyBoxMeshDesc.ts",
    "shaders/glsl/skyBox*",
  ],
  lookFor:
    "A SkyBoxMeshDesc sky with stars and a color-grading LUT over OpenStreetMap; the pane toggles its visibility and sets its day, night and sun colors, and the date control moves the sun. Look for colors that do not update or a sky that does not follow the time of day.",
  params: {},
  evidenceFor: [384],
} satisfies DevPageMeta;
