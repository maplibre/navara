import { Matrix4, ShaderChunk, type DirectionalLight } from "three";

/**
 * Uniform holding per-cascade directional shadow matrices composed against
 * the render camera's world matrix on the CPU: `light.shadow.matrix *
 * camera.matrixWorld` (f64).
 *
 * Sampling shadow maps with `directionalShadowMatrix * worldPosition` loses
 * precision on a globe: the absolute ECEF world position (~6.4e6 m) and the
 * shadow matrix translation cancel in f32 on the GPU, and because the CSM
 * cascade matrices follow the camera the rounding error changes every frame —
 * received shadows jitter while the geometry itself stays put.
 *
 * Folding the camera's world matrix in instead lets the shader use the
 * view-space position `mvPosition`, which is precise by construction for
 * every positioning mode: RTE meshes compute it from camera-relative
 * coordinates, RTC meshes get it from the CPU-composed f64 modelViewMatrix,
 * and instancing folds instanceMatrix into it. Shadow sampling then reuses
 * the exact quantity that renders stably, so it can never jitter relative to
 * the geometry — and a single patch covers every mesh type.
 */
/** Defined in the fragment shader of a material patched for view-space shadows. */
export const VIEW_SPACE_SHADOW_DEFINE = "NVR_VIEW_SPACE_SHADOW";

export type ShadowMatricesViewUniform = { value: Matrix4[] };

const SHADOW_MATRIX_VIEW_PARS_VERTEX = /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
// Per-cascade shadow matrices composed with the render camera's world matrix
// on the CPU in f64 (shadow.matrix * camera.matrixWorld). Multiplied with the
// view-space position instead of the absolute world position to avoid f32
// cancellation at ECEF magnitudes.
//
// Only the CSM cascade lights (the first CSM_CASCADE_COUNT shadow indices,
// matching the ordering assumption of the CSM fragment shader) get these
// matrices; additional shadow-casting directional lights keep the stock
// directionalShadowMatrix path. Outside a CSM material the define is absent —
// treat every directional shadow as camera-composed then.
#ifndef CSM_CASCADE_COUNT
#define CSM_CASCADE_COUNT NUM_DIR_LIGHT_SHADOWS
#endif
uniform mat4 nvrCsmShadowMatrixView[ CSM_CASCADE_COUNT ];
#endif
`;

/** Replace `search` in `source`, throwing when the pattern is missing so a
 * three.js chunk drift surfaces as an error instead of a silent no-op. */
function replaceOrThrow(
  source: string,
  search: string,
  replace: string,
): string {
  if (!source.includes(search)) {
    throw new Error(
      `Failed to replace "${search}" in shader code. The pattern was not found.`,
    );
  }
  return source.replace(search, replace);
}

/**
 * Rewrite a material's vertex shader so directional (CSM) shadow coordinates
 * are computed from the view-space position and the camera-composed shadow
 * matrices instead of `directionalShadowMatrix * worldPosition`.
 *
 * Requires `mvPosition` to be in scope at `#include <shadowmap_vertex>`,
 * which holds for every three.js built-in lit shader and for RTE projection
 * chunks. The world-space normal bias is rotated into view space with
 * `viewMatrix`, which is exactly equivalent to the stock world-space offset.
 *
 * Point/spot shadows — and shadow-casting directional lights beyond the CSM
 * cascades (`CSM_CASCADE_COUNT`) — keep the stock absolute-world-position
 * path, so extra lights coexist with the cascades exactly as before. Shaders
 * without `#include <shadowmap_vertex>` (unlit, depth, or fully custom) are
 * left untouched, as are shaders compiled for the shadow-map depth pass
 * (`USE_SHADOWMAP_DEPTH` — they never sample shadows and would upload the
 * uniform before the shadow maps for the frame are rendered).
 *
 * The fragment shader gets `NVR_VIEW_SPACE_SHADOW` defined, so code that
 * computes shadow coordinates there (`chunks/ground_shadow_coord_fragment`)
 * takes the same path.
 */
export function applyViewSpaceShadowReceive(
  shader: {
    vertexShader: string;
    fragmentShader: string;
    defines?: Record<string, unknown>;
    uniforms: Record<string, { value: unknown }>;
  },
  uniform: ShadowMatricesViewUniform,
): void {
  if (shader.defines?.["USE_SHADOWMAP_DEPTH"]) return;
  if (!shader.vertexShader.includes("#include <shadowmap_vertex>")) return;

  shader.uniforms.nvrCsmShadowMatrixView = uniform;
  shader.fragmentShader = `#define ${VIEW_SPACE_SHADOW_DEFINE}\n${shader.fragmentShader}`;

  // Rewrite only the directional-light loop of three's shadowmap_vertex
  // chunk, preserving the unroll pragmas. Each line becomes a per-index
  // preprocessor branch (the unroller substitutes UNROLLED_LOOP_INDEX with a
  // literal, the same pattern the CSM fragment shader uses): cascade indices
  // take the view-space path, any additional shadow-casting directional
  // lights keep the stock path — their matrices are managed by three, not by
  // the CSM compose, so routing them through nvrCsmShadowMatrixView would
  // read past the uploaded array.
  let shadowmapVertexView = replaceOrThrow(
    ShaderChunk.shadowmap_vertex,
    "shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );",
    `#if UNROLLED_LOOP_INDEX < CSM_CASCADE_COUNT
			shadowWorldPosition = vec4( mvPosition.xyz + ( viewMatrix * vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0.0 ) ).xyz, 1.0 );
			#else
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			#endif`,
  );
  shadowmapVertexView = replaceOrThrow(
    shadowmapVertexView,
    "vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;",
    `#if UNROLLED_LOOP_INDEX < CSM_CASCADE_COUNT
			vDirectionalShadowCoord[ i ] = nvrCsmShadowMatrixView[ i ] * shadowWorldPosition;
			#else
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
			#endif`,
  );

  shader.vertexShader = replaceOrThrow(
    replaceOrThrow(
      shader.vertexShader,
      "#include <shadowmap_pars_vertex>",
      `#include <shadowmap_pars_vertex>\n${SHADOW_MATRIX_VIEW_PARS_VERTEX}`,
    ),
    "#include <shadowmap_vertex>",
    shadowmapVertexView,
  );
}

/**
 * Compose `light.shadow.matrix * cameraMatrixWorld` for each cascade light
 * into `matrices`, entirely in f64. The camera must be the render camera of
 * the pass (its `viewMatrix` produced the `mvPosition` the shader multiplies
 * with), and `shadow.matrix` must already hold the current frame's cascade
 * transform — three.js renders the shadow maps before any main-pass material
 * uploads its uniforms, so refreshing lazily at upload time is safe.
 */
export function composeViewSpaceShadowMatrices(
  lights: readonly DirectionalLight[],
  cameraMatrixWorld: Matrix4,
  matrices: Matrix4[],
): void {
  matrices.length = lights.length;
  for (let i = 0; i < lights.length; i++) {
    const matrix = matrices[i] ?? (matrices[i] = new Matrix4());
    matrix.multiplyMatrices(lights[i].shadow.matrix, cameraMatrixWorld);
  }
}
