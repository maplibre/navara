import ShadowMapDepthFragment from "@shaders/glsl/chunks/shadowmap_depth_fragment.glsl";
import ShadowMapDepthParsFragment from "@shaders/glsl/chunks/shadowmap_depth_pars_fragment.glsl";
import ShadowMapDepthParsVertex from "@shaders/glsl/chunks/shadowmap_depth_pars_vertex.glsl";
import ShadowMapDepthVertex from "@shaders/glsl/chunks/shadowmap_depth_vertex.glsl";
import type { WebGLProgramParametersWithUniforms } from "three";

import { createReplacer } from "../../../../utils";

import type { ShadowMapDepthMutates, ShadowMapDepthState } from "./types";

export const transformShader = (
  shader: WebGLProgramParametersWithUniforms,
  _state: ShadowMapDepthState,
  mutates: ShadowMapDepthMutates,
): void => {
  mutates.updateUniforms(shader.uniforms, _state);

  shader.vertexShader = createReplacer(shader.vertexShader)
    .replace(
      "#include <common>",
      `
#include <common>
#include <packing>
${ShadowMapDepthParsVertex}
`,
    )
    .replace(
      "#include <clipping_planes_vertex>",
      `
#include <clipping_planes_vertex>
${ShadowMapDepthVertex}
`,
    ).source;

  // Transform fragment shader - add shadow map depth output
  shader.fragmentShader = createReplacer(shader.fragmentShader).replace(
    "void main() {",
    `
${ShadowMapDepthParsFragment}

void main() {
  ${ShadowMapDepthFragment}
`,
  ).source;
};
