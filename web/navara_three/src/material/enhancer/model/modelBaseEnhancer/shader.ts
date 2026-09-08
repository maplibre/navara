import BatchEmissiveFragment from "@shaders/glsl/chunks/batch_emissive_fragment.glsl";
import BatchTextureParsVertex from "@shaders/glsl/chunks/batch_texture_pars_vertex.glsl";
import BatchTextureVertex from "@shaders/glsl/chunks/batch_texture_vertex.glsl";
import Pick from "@shaders/glsl/chunks/pick.glsl";
import ShadowMapDepthFragment from "@shaders/glsl/chunks/shadowmap_depth_fragment.glsl";
import ShadowMapDepthParsFragment from "@shaders/glsl/chunks/shadowmap_depth_pars_fragment.glsl";
import ShadowMapDepthParsVertex from "@shaders/glsl/chunks/shadowmap_depth_pars_vertex.glsl";
import ShadowMapDepthVertex from "@shaders/glsl/chunks/shadowmap_depth_vertex.glsl";
import ShowFragment from "@shaders/glsl/chunks/show_fragment.glsl";
import ShowParsFragment from "@shaders/glsl/chunks/show_pars_fragment.glsl";
import ShowParsVertex from "@shaders/glsl/chunks/show_pars_vertex.glsl";
import SpecularParsFragment from "@shaders/glsl/chunks/spucular_pars_fragment.glsl";
import type { WebGLProgramParametersWithUniforms } from "three";

import { createReplacer } from "../../../../utils";
import { GBUFFER_NORMAL_WRITE_PHYSICAL } from "../../../gbufferLayout";

import { MODEL_BASE_SHADER_MARKERS } from "./markers";
import type { SupportedMaterial } from "./material";
import type { ModelBaseMutates, ModelBaseState } from "./types";

/**
 * Transform shader with core model modifications.
 * Uniform assignment is handled by mutates.updateUniforms().
 */
export const transformShader = (
  shader: WebGLProgramParametersWithUniforms,
  state: ModelBaseState,
  mutates: ModelBaseMutates,
  material: SupportedMaterial,
): void => {
  // Set core shader defines
  shader.defines ??= {};
  shader.defines.USE_SELECTIVE_EFFECT = 1;

  if (material.userData.defines) {
    Object.assign(shader.defines, material.userData.defines);
  }

  // Assign uniform refs to shader.uniforms via mutates
  mutates.updateUniforms(shader.uniforms, state);

  // Transform vertex shader
  shader.vertexShader = createReplacer(shader.vertexShader)
    .replace(
      "void main() {",
      `
#include <packing>

in float batchId;
flat out float nvr_vBatchId;
out vec3 vPosition;

${ShowParsVertex}
${BatchTextureParsVertex}

${ShadowMapDepthParsVertex}

void main() {
  nvr_vBatchId = batchId;
`,
    )
    .replace(
      "#include <color_vertex>",
      `
#include <color_vertex>

${BatchTextureVertex}
`,
    )
    .replace(
      "#include <clipping_planes_vertex>",
      `
#include <clipping_planes_vertex>
vPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
${ShadowMapDepthVertex}
`,
    ).source;

  // Transform fragment shader
  shader.fragmentShader = createReplacer(shader.fragmentShader)
    .replace(
      "void main() {",
      `
#include <packing>

${MODEL_BASE_SHADER_MARKERS.fragment.UNIFORM_START}
uniform float nvr_uPickable;
// uEffectIdsMask is declared by overrideMaterialsForMRT (#ifdef USE_SELECTIVE_EFFECT block)
${MODEL_BASE_SHADER_MARKERS.fragment.UNIFORM_END}

flat in float nvr_vBatchId;

${ShowParsFragment}

${Pick}

${ShadowMapDepthParsFragment}

void main() {
  ${ShowFragment}
  ${ShadowMapDepthFragment}
`,
    )
    .replace(
      "#include <color_fragment>",
      `
#include <color_fragment>

#ifdef USE_BATCH_SHOW_OPACITY
  diffuseColor.a *= nvr_vOpacity;
#endif
`,
    )
    .replace(
      "#include <emissivemap_fragment>",
      `
${BatchEmissiveFragment}
#include <emissivemap_fragment>
`,
    )
    .replace(
      "#include <lights_physical_pars_fragment>",
      `
#include <lights_physical_pars_fragment>
${SpecularParsFragment}
`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      `
${MODEL_BASE_SHADER_MARKERS.fragment.NORMAL_START}
vec3 origNormal = normal;
vec3 specular;
#include <normal_fragment_maps>
${MODEL_BASE_SHADER_MARKERS.fragment.NORMAL_END}
`,
    )
    .replace(
      "vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;",
      `
${MODEL_BASE_SHADER_MARKERS.fragment.OUTGOING_LIGHT_START}
vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
${MODEL_BASE_SHADER_MARKERS.fragment.OUTGOING_LIGHT_END}
`,
    )
    .replace(
      "#include <dithering_fragment>",
      `
#include <dithering_fragment>
if (nvr_uPickable > 0.0 && diffuseColor.a > 0.0) {
  vec3 pickColor = nvr_batchIdToColor(nvr_vBatchId);
  gl_FragColor = vec4(pickColor.xyz, 1.0);
}
`,
    )
    .replace(
      GBUFFER_NORMAL_WRITE_PHYSICAL,
      `
${MODEL_BASE_SHADER_MARKERS.fragment.FINAL_NORMAL_START}
vec3 finalNormal = normal;
${MODEL_BASE_SHADER_MARKERS.fragment.FINAL_NORMAL_END}
GBUFFER_WRITE_NORMAL(finalNormal, metalnessFactor, roughnessFactor)
`,
    ).source;
};
