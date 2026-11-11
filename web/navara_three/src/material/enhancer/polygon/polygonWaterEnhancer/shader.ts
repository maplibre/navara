import type { WebGLProgramParametersWithUniforms } from "three";

import {
  WATER_REFS_UNIFORMS,
  applyWaterDefine,
  insertWaterChunk,
} from "../../water";
import {
  POLYGON_BASE_SHADER_MARKERS,
  createPolygonBaseShaderReplacer,
} from "../polygonBaseEnhancer/markers";

import type { PolygonWaterState, WaterMutates } from "./types";

/**
 * Transform shader with water-specific modifications.
 * Uniform assignment is handled by mutates.updateUniforms().
 */
export const transformWaterShader = (
  shader: WebGLProgramParametersWithUniforms,
  state: PolygonWaterState,
  mutates: WaterMutates,
): void => {
  const { useWater } = state;

  shader.defines ??= {};
  applyWaterDefine(shader.defines, useWater);

  // Assign water uniform refs to shader.uniforms via mutates
  mutates.updateUniforms(shader.uniforms, state);

  if (useWater) {
    shader.fragmentShader = insertWaterChunk(shader.fragmentShader);
  }

  const replacer = createPolygonBaseShaderReplacer(shader.fragmentShader)
    .insertAfter(
      POLYGON_BASE_SHADER_MARKERS.fragment.UNIFORM_END,
      WATER_REFS_UNIFORMS,
    )
    .insertAfter(
      POLYGON_BASE_SHADER_MARKERS.fragment.NORMAL_END,
      useWater
        ? `
// uIsTexturized is a uniform, so the derivatives stay in uniform control flow.
NvrWaterSurface nvr_waterSurface;
if(!uIsTexturized) {
  nvr_waterSurface = nvrWaterSurface(nvrWaterCoord(vViewPosition), origNormal, uWaveExaggeration, 0);
}`
        : `
if(uSpecular && !uIsTexturized) {
  specular = computeSpecular(
    vViewPosition,
    origNormal,
    uShininess,
    uSpecularStrength,
    uIor
  );
}`,
    );
  if (!useWater) {
    shader.fragmentShader = replacer.source;
    return;
  }
  shader.fragmentShader = replacer
    .replaceBlock(
      {
        start: POLYGON_BASE_SHADER_MARKERS.fragment.OUTGOING_LIGHT_START,
        end: POLYGON_BASE_SHADER_MARKERS.fragment.OUTGOING_LIGHT_END,
      },
      `if(!uIsTexturized) {
    outgoingLight = nvrWaterShade(nvr_waterSurface, vViewPosition, origNormal, outgoingLight);
  }`,
    )
    .replaceBlock(
      {
        start: POLYGON_BASE_SHADER_MARKERS.fragment.FINAL_NORMAL_START,
        end: POLYGON_BASE_SHADER_MARKERS.fragment.FINAL_NORMAL_END,
      },
      `vec3 finalNormal = uIsTexturized ? origNormal : nvr_waterSurface.gbufferNormal;
float finalReflectivity = uIsTexturized ? reflectivity : NVR_WATER_F0;
float finalRoughness = uIsTexturized ? roughnessFactor : nvr_waterSurface.gbufferRoughness;`,
    ).source;
};
