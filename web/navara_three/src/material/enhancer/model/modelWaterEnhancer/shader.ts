import type { WebGLProgramParametersWithUniforms } from "three";

import {
  WATER_REFS_UNIFORMS,
  applyWaterDefine,
  insertWaterChunk,
} from "../../water";
import {
  MODEL_BASE_SHADER_MARKERS,
  createModelBaseShaderReplacer,
} from "../modelBaseEnhancer/markers";

import type { ModelWaterMutates, ModelWaterState } from "./types";

/**
 * Transform shader with water-specific modifications.
 * Uniform assignment is handled by mutates.updateUniforms().
 */
export const transformWaterShader = (
  shader: WebGLProgramParametersWithUniforms,
  state: ModelWaterState,
  mutates: ModelWaterMutates,
): void => {
  const { useWater } = state;

  shader.defines ??= {};
  applyWaterDefine(shader.defines, useWater);

  // Assign water uniform refs to shader.uniforms via mutates
  mutates.updateUniforms(shader.uniforms, state);

  if (useWater) {
    shader.fragmentShader = insertWaterChunk(shader.fragmentShader);
  }

  const replacer = createModelBaseShaderReplacer(shader.fragmentShader)
    .insertAfter(
      MODEL_BASE_SHADER_MARKERS.fragment.UNIFORM_END,
      WATER_REFS_UNIFORMS,
    )
    .replaceBlock(
      {
        start: MODEL_BASE_SHADER_MARKERS.fragment.NORMAL_START,
        end: MODEL_BASE_SHADER_MARKERS.fragment.NORMAL_END,
      },
      useWater
        ? `vec3 origNormal = normal;
NvrWaterSurface nvr_waterSurface = nvrWaterSurface(nvrWaterCoord(vViewPosition), origNormal, uWaveExaggeration, 0);`
        : `vec3 origNormal = normal;
vec3 specular;
if(uSpecular) {
  specular = computeSpecular(
    vViewPosition,
    origNormal,
    uShininess,
    uSpecularStrength,
    uIor
  );
}
#include <normal_fragment_maps>`,
    );

  shader.fragmentShader = (
    useWater
      ? replacer
          // The water's own reflection replaces the glTF material's specular.
          .replaceBlock(
            {
              start: MODEL_BASE_SHADER_MARKERS.fragment.OUTGOING_LIGHT_START,
              end: MODEL_BASE_SHADER_MARKERS.fragment.OUTGOING_LIGHT_END,
            },
            `vec3 outgoingLight = nvrWaterShade(nvr_waterSurface, vViewPosition, origNormal, totalDiffuse + totalEmissiveRadiance);`,
          )
          .replaceBlock(
            {
              start: MODEL_BASE_SHADER_MARKERS.fragment.FINAL_NORMAL_START,
              end: MODEL_BASE_SHADER_MARKERS.fragment.FINAL_NORMAL_END,
            },
            `vec3 finalNormal = nvr_waterSurface.gbufferNormal;
float finalReflectivity = NVR_WATER_F0;
float finalRoughness = nvr_waterSurface.gbufferRoughness;`,
          )
      : replacer.insertAfter(
          MODEL_BASE_SHADER_MARKERS.fragment.OUTGOING_LIGHT_END,
          "outgoingLight += specular;",
        )
  ).source;
};
