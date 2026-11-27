import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/meshes/arcLine.ts",
    "web/navara_three_default_descs/src/meshes/ArclineMeshDesc.ts",
    "shaders/glsl/arcLine*",
    "web/navara_three_default_descs/src/meshes/smoothLine.ts",
    "web/navara_three_default_descs/src/meshes/SmoothLineMeshDesc.ts",
  ],
  lookFor:
    "ArclineMeshDesc arcs between world cities and SmoothLineMeshDesc curves (a satellite orbit, a Falcon 9 launch) over the globe: per line, the pane edits arc height, width, color, gradation and dashes, with animated gradation and dash offset; the arcs should rise smoothly from both ends and the dashes should scroll without popping.",
  params: {},
  evidenceFor: [244, 252, 263, 323, 328, 332],
} satisfies DevPageMeta;
