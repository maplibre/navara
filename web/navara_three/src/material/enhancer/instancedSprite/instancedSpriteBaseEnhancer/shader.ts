import instancedSpriteFragmentShader from "@shaders/glsl/instancedSprite.frag.glsl";
import instancedSpriteVertexShader from "@shaders/glsl/instancedSprite.vert.glsl";
import type { WebGLProgramParametersWithUniforms } from "three";

import type { SupportedMaterial } from "./material";
import type {
  InstancedSpriteBaseMutates,
  InstancedSpriteBaseState,
} from "./types";

/**
 * Transform shader with instancedSprite base modifications.
 *
 * InstancedSprites use custom ShaderMaterial shaders. This function:
 * 1. Sets the vertex/fragment shader sources
 * 2. Sets defines based on state (USE_RTE, BILLBOARD)
 * 3. Assigns uniform refs via mutates.updateUniforms()
 */
export const transformShader = (
  shader: WebGLProgramParametersWithUniforms,
  state: InstancedSpriteBaseState,
  mutates: InstancedSpriteBaseMutates,
  material: SupportedMaterial,
): void => {
  // Set shaders — instancedSprite always uses the same shader pair
  shader.vertexShader = instancedSpriteVertexShader;
  shader.fragmentShader = instancedSpriteFragmentShader;

  // Set defines based on state
  shader.defines ??= {};

  if (state.useRTE) {
    shader.defines.USE_RTE = 1;
  }

  if (state.billboard) {
    shader.defines.BILLBOARD = 1;
  }

  shader.defines.USE_SELECTIVE_EFFECT = 1;

  if (material.userData?.defines) {
    Object.assign(shader.defines, material.userData.defines);
  }

  // Assign uniform refs to shader.uniforms via mutates
  mutates.updateUniforms(shader.uniforms, state);
};
