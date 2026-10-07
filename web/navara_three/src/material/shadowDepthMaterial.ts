import {
  RGBADepthPacking,
  type Material,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";

import { attachBatchedMaterial } from "../batchTexture/material";

/**
 * Shadow-map depth material for an enhanced material. Three's default depth
 * material reads none of the enhancer's attributes (RTE positions, extrusion),
 * so the caster would draw nothing.
 *
 * `transformShader` defaults to the origin's `onBeforeCompile`, read at
 * compile time. The clone also compiles with the origin's
 * `userData.defines` and batch layout defines.
 */
export function createShadowDepthMaterial<M extends Material>(
  origin: M,
  transformShader: (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => void = (shader, renderer) => origin.onBeforeCompile(shader, renderer),
): M {
  const depth = origin.clone() as M;
  // Layout allocations on the origin must recompile the clone too.
  attachBatchedMaterial(origin, depth);
  // The prefix separates it from the origin's own program.
  depth.customProgramCacheKey = () =>
    `nvr-depth:${origin.customProgramCacheKey()}`;
  depth.onBeforeCompile = (shader, renderer) => {
    transformShader(shader, renderer);
    shader.defines ??= {};
    Object.assign(shader.defines, origin.userData.defines ?? {});
    shader.defines.USE_SHADOWMAP_DEPTH = 1;
    shader.defines.DEPTH_PACKING = RGBADepthPacking;
  };
  return depth;
}
