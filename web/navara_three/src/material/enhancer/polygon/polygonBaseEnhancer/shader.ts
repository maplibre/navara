import BatchEmissiveFragment from "@shaders/glsl/chunks/batch_emissive_fragment.glsl";
import BatchTextureParsVertex from "@shaders/glsl/chunks/batch_texture_pars_vertex.glsl";
import BatchTextureVertex from "@shaders/glsl/chunks/batch_texture_vertex.glsl";
import BranchFreeTernary from "@shaders/glsl/chunks/branchFreeTernary.glsl";
import ExtrudedHeightParsVertex from "@shaders/glsl/chunks/extruded_height_pars_vertex.glsl";
import ExtrudedHeightVertex from "@shaders/glsl/chunks/extruded_height_vertex.glsl";
import HeightParsVertex from "@shaders/glsl/chunks/height_pars_vertex.glsl";
import HeightVertex from "@shaders/glsl/chunks/height_vertex.glsl";
import Pick from "@shaders/glsl/chunks/pick.glsl";
import ProjectVertexRte from "@shaders/glsl/chunks/project_vertex_rte.glsl";
import RteParsVertex from "@shaders/glsl/chunks/rte_pars_vertex.glsl";
import RteVertex from "@shaders/glsl/chunks/rte_vertex.glsl";
import ShadowMapDepthFragment from "@shaders/glsl/chunks/shadowmap_depth_fragment.glsl";
import ShadowMapDepthParsFragment from "@shaders/glsl/chunks/shadowmap_depth_pars_fragment.glsl";
import ShadowMapDepthParsVertex from "@shaders/glsl/chunks/shadowmap_depth_pars_vertex.glsl";
import ShadowMapDepthVertex from "@shaders/glsl/chunks/shadowmap_depth_vertex.glsl";
import ShowFragment from "@shaders/glsl/chunks/show_fragment.glsl";
import ShowParsFragment from "@shaders/glsl/chunks/show_pars_fragment.glsl";
import ShowParsVertex from "@shaders/glsl/chunks/show_pars_vertex.glsl";
import SpecularParsFragment from "@shaders/glsl/chunks/spucular_pars_fragment.glsl";
import { ShaderChunk } from "three";
import type { WebGLProgramParametersWithUniforms } from "three";

import { createReplacer } from "../../../../utils";
import { GBUFFER_NORMAL_WRITE_BASIC } from "../../../gbufferLayout";

import { POLYGON_BASE_SHADER_MARKERS } from "./markers";
import type { SupportedMaterial } from "./material";
import type { PolygonBaseMutates, PolygonBaseState } from "./types";

/**
 * Transform shader with core polygon modifications.
 * Uniform assignment is handled by mutates.updateUniforms().
 */
export const transformShader = (
  shader: WebGLProgramParametersWithUniforms,
  state: PolygonBaseState,
  mutates: PolygonBaseMutates,
  material: SupportedMaterial,
): void => {
  const { useRTE } = state;

  // Set core shader defines
  shader.defines ??= {};
  shader.defines.USE_ROUGHNESS = 1;
  shader.defines.USE_SELECTIVE_EFFECT = 1;

  if (material.userData.defines) {
    Object.assign(shader.defines, material.userData.defines);
  }

  // Assign uniform refs to shader.uniforms via mutates
  mutates.updateUniforms(shader.uniforms, state);

  // Transform vertex shader
  shader.vertexShader = createReplacer(shader.vertexShader)
    .replace(
      "#include <common>",
      `
#include <common>
#include <packing>

in float attrBatchId;
in vec4 scaleNormalAndCap;

uniform vec2 uMinMaxHeight;
flat out float nvr_vBatchId;

${useRTE ? RteParsVertex : ""}
${ShowParsVertex}
${ExtrudedHeightParsVertex}
${HeightParsVertex}
${BatchTextureParsVertex}

${BranchFreeTernary}

${ShadowMapDepthParsVertex}

varying vec3 vPosition;
`,
    )
    .replace(
      "#include <begin_vertex>",
      `
${useRTE ? RteVertex : "#include <begin_vertex>"}

${ExtrudedHeightVertex}
${HeightVertex}
${BatchTextureVertex}

transformed.xyz += scaleNormalAndCap.xyz * nvr_branchFreeTernary(
  scaleNormalAndCap.w == 0.0,
  uMinMaxHeight.x + addHeight,
  uMinMaxHeight.y + addExtrudedHeight
);

// Use the original GlobalBatchId for picking, not the batch_index
nvr_vBatchId = attrBatchId;
`,
    )
    .replace(
      "#include <clipping_planes_vertex>",
      `
#include <clipping_planes_vertex>
${ShadowMapDepthVertex}
`,
    )
    .replaceWithCondition("#include <project_vertex>", ProjectVertexRte, useRTE)
    .replaceWithCondition(
      "#include <envmap_vertex>",
      `
#include <envmap_vertex>

vPosition = absTransformed.xyz;
// mvPosition comes from the RTE projection (modelViewMatrixRTE * camera-relative
// position), so it is precise at any distance. Deriving vViewPosition from
// modelViewMatrix * absTransformed instead would suffer f32 cancellation at
// ECEF magnitude and make view-dependent shading wobble as the camera moves.
vViewPosition = -mvPosition.xyz;
`,
      useRTE,
    )
    .replaceWithCondition(
      "#include <worldpos_vertex>",
      createReplacer(ShaderChunk.worldpos_vertex).replace(
        "vec4 worldPosition = vec4( transformed, 1.0 );",
        "vec4 worldPosition = vec4( absTransformed, 1.0 );",
      ).source,
      useRTE,
    )
    .replaceWithCondition(
      "#include <envmap_vertex>",
      `
#include <envmap_vertex>

vPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
`,
      !useRTE,
    ).source;

  // Transform fragment shader
  shader.fragmentShader = createReplacer(shader.fragmentShader)
    .replace(
      "#include <common>",
      `
#include <common>
#include <packing>
`,
    )
    .replace(
      "uniform vec3 diffuse;",
      `
${POLYGON_BASE_SHADER_MARKERS.fragment.UNIFORM_START}
uniform vec3 diffuse;
uniform bool uClampToGround;
uniform float nvr_uPickable;
// uEffectIdsMask is declared by overrideMaterialsForMRT (#ifdef USE_SELECTIVE_EFFECT block)
uniform bool uIsTexturized;
${POLYGON_BASE_SHADER_MARKERS.fragment.UNIFORM_END}

flat in float nvr_vBatchId;

${ShowParsFragment}

${Pick}

${ShadowMapDepthParsFragment}
`,
    )
    .replace(
      "#include <lights_lambert_pars_fragment>",
      `
#include <lights_lambert_pars_fragment>

${SpecularParsFragment}
`,
    )
    .replace(
      "void main() {",
      `
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
      "#include <normal_fragment_maps>",
      `
${POLYGON_BASE_SHADER_MARKERS.fragment.NORMAL_START}

vec3 origNormal = vec3(normal);
vec3 specular;

#include <normal_fragment_maps>

${POLYGON_BASE_SHADER_MARKERS.fragment.NORMAL_END}
`,
    )
    .replace(
      "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;",
      `
vec3 outgoingLight;
if(uClampToGround) {
  // Without lighting
  outgoingLight = diffuseColor.xyz;
} else {
  outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
  if(!uIsTexturized) {
    outgoingLight += specular;
  }
}
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
      GBUFFER_NORMAL_WRITE_BASIC,
      `
${POLYGON_BASE_SHADER_MARKERS.fragment.FINAL_NORMAL_START}
vec3 finalNormal = origNormal;
${POLYGON_BASE_SHADER_MARKERS.fragment.FINAL_NORMAL_END}
GBUFFER_WRITE_NORMAL(finalNormal, reflectivity, roughnessFactor)
`,
    ).source;
};
