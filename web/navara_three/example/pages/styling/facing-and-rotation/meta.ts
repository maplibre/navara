import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "shaders/glsl/chunks/quad_orientation.glsl",
    "web/navara_three/src/mesh/sdfText/**",
    "web/navara_three/src/mesh/sprite/**",
    "shaders/glsl/sdfText.vert.glsl",
    "shaders/glsl/instancedSprite.vert.glsl",
    "shaders/glsl/chunks/batch_texture_vertex.glsl",
    "web/navara_three/src/batchTexture/**",
  ],
  lookFor:
    "Columns of text, billboard and point instances with an asymmetric arrow; the material folder sets facing, rotateWithCamera and rotation for all three layers, the per-instance folder varies one of them per instance through the evaluator, and all three kinds should orient identically.",
  params: {},
  evidenceFor: [833],
} satisfies DevPageMeta;
