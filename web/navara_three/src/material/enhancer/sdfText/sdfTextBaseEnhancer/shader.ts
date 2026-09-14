import { SDF_PX_SIZE } from "@navaramap/font";
import sdfTextFragmentShader from "@shaders/glsl/sdfText.frag.glsl";
import sdfTextVertexShader from "@shaders/glsl/sdfText.vert.glsl";
import type { WebGLProgramParametersWithUniforms } from "three";

import {
  MSDF_FULL_DETAIL_PPEM,
  MSDF_TRUE_SDF_END_PPEM,
  SMALL_TEXT_SUPERSAMPLE_END_PPEM,
  SMALL_TEXT_SUPERSAMPLE_FULL_PPEM,
  SMALL_TEXT_STEM_DARKEN_END_PPEM,
  SMALL_TEXT_STEM_DARKEN_FULL_PPEM,
  SMALL_TEXT_STEM_DARKEN_MAX_PX,
} from "./coverage";
import type { SupportedMaterial } from "./material";
import {
  LABEL_ROWS,
  sdfRadiusFor,
  type SdfTextBaseMutates,
  type SdfTextBaseState,
} from "./types";

/**
 * Transform shader with sdfText base modifications.
 *
 * SdfText uses custom ShaderMaterial shaders. This function:
 * 1. Sets the vertex/fragment shader sources
 * 2. Sets defines based on state (USE_RTE)
 * 3. Assigns uniform refs via mutates.updateUniforms()
 */
export const transformShader = (
  shader: WebGLProgramParametersWithUniforms,
  state: SdfTextBaseState,
  mutates: SdfTextBaseMutates,
  material?: SupportedMaterial,
): void => {
  // Set shaders — sdfText always uses the same shader pair
  shader.vertexShader = sdfTextVertexShader;
  shader.fragmentShader = sdfTextFragmentShader;

  // Set defines based on state
  shader.defines ??= {};

  // Stride of the per-label data texture. Injected rather than hard-coded in
  // GLSL so the shader's row addressing always matches `LabelRow`.
  shader.defines.LABEL_ROWS = LABEL_ROWS;
  // These values are compile-time constants for a material: quality is
  // immutable, and all glyphs in an atlas use the same raster density/range.
  // Injecting them from the TypeScript sources of truth prevents the shader's
  // screen-pixel coverage math from drifting from the worker.
  shader.defines.NVR_SDF_PX_SIZE = SDF_PX_SIZE;
  shader.defines.NVR_SDF_PX_RANGE = sdfRadiusFor(state.useMsdf);
  shader.defines.NVR_SMALL_TEXT_SS_FULL_PPEM = SMALL_TEXT_SUPERSAMPLE_FULL_PPEM;
  shader.defines.NVR_SMALL_TEXT_SS_END_PPEM = SMALL_TEXT_SUPERSAMPLE_END_PPEM;
  shader.defines.NVR_SMALL_TEXT_DARKEN_MAX_PX = SMALL_TEXT_STEM_DARKEN_MAX_PX;
  shader.defines.NVR_SMALL_TEXT_DARKEN_FULL_PPEM =
    SMALL_TEXT_STEM_DARKEN_FULL_PPEM;
  shader.defines.NVR_SMALL_TEXT_DARKEN_END_PPEM =
    SMALL_TEXT_STEM_DARKEN_END_PPEM;
  shader.defines.NVR_MSDF_TRUE_SDF_END_PPEM = MSDF_TRUE_SDF_END_PPEM;
  shader.defines.NVR_MSDF_FULL_DETAIL_PPEM = MSDF_FULL_DETAIL_PPEM;

  if (state.useRTE) {
    shader.defines.USE_RTE = 1;
  }
  if (state.useMsdf) {
    shader.defines.USE_MSDF = 1;
  }

  shader.defines.USE_SELECTIVE_EFFECT = 1;

  // Batch texture layout defines (BATCHED_TEXTURE_* / USE_BATCH_*)
  if (material?.userData?.defines) {
    Object.assign(shader.defines, material.userData.defines);
  }

  // Assign uniform refs to shader.uniforms via mutates
  mutates.updateUniforms(shader.uniforms, state);
};
