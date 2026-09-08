import FlatPolylineFragShader from "@shaders/glsl/flatPolyline.frag.glsl";
import FlatPolylineVertShader from "@shaders/glsl/flatPolyline.vert.glsl";
import PolylineFragShader from "@shaders/glsl/polyline.frag.glsl";
import PolylineVertShader from "@shaders/glsl/polyline.vert.glsl";
import { packing } from "@takram/three-geospatial/shaders";
import type { WebGLProgramParametersWithUniforms } from "three";

import type { SupportedMaterial } from "./material";
import type { PolylineBaseMutates, PolylineBaseState } from "./types";

/**
 * Select appropriate shaders based on polyline state.
 *
 * @param isTexturized - Whether the polyline is rendered as flat texturized tile
 * @returns Object with vertexShader and fragmentShader code
 */
const selectShaders = (
  isTexturized: boolean,
): { vertexShader: string; fragmentShader: string } => {
  if (isTexturized) {
    // Flat polyline for texturized tile rendering
    return {
      vertexShader: FlatPolylineVertShader,
      fragmentShader: FlatPolylineFragShader,
    };
  }

  // 3D polyline for globe rendering
  const fragmentShader = `${packing}\n` + PolylineFragShader;

  return {
    vertexShader: PolylineVertShader,
    fragmentShader,
  };
};

/**
 * Transform shader with polyline base modifications.
 *
 * For polylines, the shaders are already provided as custom GLSL (polyline.vert.glsl, polyline.frag.glsl).
 * This function primarily handles uniform assignment via mutates.updateUniforms().
 *
 * The shader transformation is minimal because:
 * 1. Polyline shaders are custom ShaderMaterial shaders (not built-in Three.js shaders)
 * 2. The shader code already contains all necessary features (RTE, batch texture, picking, etc.)
 * 3. Features are controlled via #define flags set in onBeforeCompile (see PolylineMesh.initMaterial)
 */
export const transformShader = (
  shader: WebGLProgramParametersWithUniforms,
  state: PolylineBaseState,
  mutates: PolylineBaseMutates,
  material: SupportedMaterial,
): void => {
  // Select and set shaders based on state
  const shaders = selectShaders(state.isTexturized);
  shader.vertexShader = shaders.vertexShader;
  shader.fragmentShader = shaders.fragmentShader;

  // Set shader defines based on state
  shader.defines ??= {};

  if (state.useRTE) {
    shader.defines.USE_RTE = true;
  }

  shader.defines.USE_SELECTIVE_EFFECT = 1;

  if (material.userData.defines) {
    Object.assign(shader.defines, material.userData.defines);
  }

  // Assign uniform refs to shader.uniforms via mutates
  mutates.updateUniforms(shader.uniforms, state);
};
