import type { WebGLProgramParametersWithUniforms } from "three";
import { ShaderChunk } from "three";

import { createReplacer } from "../../../../utils";

import type { PntsMutates, PntsState } from "./types";

/**
 * Transform shader with PNTS-specific modifications.
 *
 * Vertex shader changes:
 * - Adds uAddHeight and uGeodeticNormal uniforms
 * - When `srgbVertexColor` is `true`, decodes sRGB vertex colors to linear
 * - Offsets vertex position along geodetic normal by uAddHeight
 */
export const transformShader = (
  shader: WebGLProgramParametersWithUniforms,
  state: PntsState,
  mutates: PntsMutates,
): void => {
  shader.defines ??= {};

  mutates.updateUniforms(shader.uniforms, state);

  shader.vertexShader = createReplacer(shader.vertexShader)
    .replace(
      "#include <common>",
      `#include <common>
    uniform float uAddHeight;
    uniform vec3 uGeodeticNormal;`,
    )
    // The chunk only defines the color space transfer functions, so it is
    // valid in a vertex shader too.
    .replaceWithCondition(
      "#include <common>",
      `#include <common>
    #include <colorspace_pars_fragment>`,
      state.srgbVertexColor,
    )
    .replaceWithCondition(
      "#include <color_vertex>",
      `#include <color_vertex>
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
vColor = sRGBTransferEOTF( vColor );
#endif`,
      state.srgbVertexColor,
    )
    .replace(
      "#include <project_vertex>",
      createReplacer(ShaderChunk.project_vertex)
        .replace(
          "vec4 mvPosition = vec4( transformed, 1.0 );",
          `vec4 mvPosition = vec4( transformed, 1.0 );
vec4 mvNormal = viewMatrix * vec4(uGeodeticNormal, 0.0);`,
        )
        .replace(
          "gl_Position = projectionMatrix * mvPosition;",
          `mvPosition += mvNormal * uAddHeight;
gl_Position = projectionMatrix * mvPosition;`,
        ).source,
    ).source;
};
