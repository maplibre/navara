/**
 * Slim TileMesh fragment-shader fragments.
 *
 * The TileMesh main pass used to unroll an N-slot texture loop per fragment
 * (`generateMixOverlaidTexturesMacro`). That cost N TMU fetches × screen
 * pixels every frame, plus another N iterations for `generateHillshadeNormal`.
 *
 * After the refactor, TileTextureCompositor bakes all N source textures into
 * a per-tile MRT atlas (color + attr + normal) only when something is dirty.
 * The main pass then does **at most three** texture lookups per fragment and
 * uses the attr atlas's encoded winning-slot index to dynamically index the
 * per-slot uniform arrays for shininess/specular/emissive/effect/etc.
 *
 * Each function returns a snippet that's spliced into a chunk via the
 * existing `createReplacer` machinery in mesh/tile.ts.
 */

import { GBUFFER_PHONG_ROUGHNESS } from "../gbufferLayout";

export type TileShaderFeatures = {
  /** Atlas has a hillshade normal that should override the default normal. */
  hasHillshade: boolean;
  /** Some layer uses Water material → emit the water surface. */
  hasWater: boolean;
  /**
   * Quantized-mesh watermask is present (source requested `requestWaterMask`),
   * which also makes the ocean a water surface.
   */
  hasWatermask: boolean;
};

const hasWaterSurface = (features: TileShaderFeatures) =>
  features.hasWater || features.hasWatermask;

/**
 * Goes after `#include <common>` in the fragment shader. Declares the three
 * atlas samplers + the per-slot uniform arrays we still index by winning
 * slot. Adds varying for the original UV.
 */
export function generateTileCommonInjection(numTextures: number): string {
  return `
  uniform sampler2D uColorAtlas;
  uniform sampler2D uAttrAtlas;
  uniform sampler2D uNormalAtlas;
  // Child-quadrant bitmask to draw (0 = whole tile); bit i covers the child
  // at (i % 2 east, i / 2 south). Tile UV has v = 0 at the south edge.
  uniform int uFillQuadrants;

  // Per-slot uniforms retained because they need full float precision and are
  // indexed once per fragment by the winning slot from attr.a.
  uniform vec3 uColors[${numTextures}];
  uniform float uReflectivities[${numTextures}];
  uniform float uRoughnesses[${numTextures}];
  // x: wave exaggeration, y: 1 when the slot is water.
  uniform vec2 uWaterParams[${numTextures}];
  // The watermask's water body color; a = 1 when the terrain layer sets one.
  uniform vec4 uWaterMaskColor;
  uniform float uWaterMaskExaggeration;
  uniform float uShininesses[${numTextures}];
  uniform float uSpecularStrengths[${numTextures}];
  uniform bool uSpeculars[${numTextures}];
  uniform float uEmissiveIntensities[${numTextures}];
  uniform vec3 uEmissiveColors[${numTextures}];
  uniform float uEffectIdsMasks[${numTextures}];

  uniform float uHillshadeExaggeration;
  uniform float uPickable;
  uniform float uIor;

  varying vec2 vOrigUv;
  varying vec3 vPosition;
  `;
}

/**
 * Goes before the water chunk. A tile holds the waves of its last draped water
 * layer and those of the watermask's water, whose body surrounds the layers.
 */
export const TILE_WATER_DEFINES = `#define NVR_WATER_WAVES_COUNT 2
#define TILE_LAYER_WAVES 0
#define TILE_WATERMASK_WAVES 1`;

/**
 * Goes in place of `#include <map_fragment>`. Reads the three atlas textures
 * once, decodes the winning slot index, and (when present) pulls per-slot
 * precision-sensitive attrs by dynamic indexing. Picking suppresses the
 * raster contribution by masking colour with the attr's isTexturized flag.
 *
 * `texturizedSceneIndexFrom` is captured at material-build time (used by
 * generateTileEmissiveBuffer below to decide what gets written to the
 * emissive/effect MRT attachments).
 */
export function generateTileMapFragment(maxTextures: number): string {
  return `
  // The color atlas is linear-filtered for display, but the pick pass reads
  // encoded batch ids out of atlasColor: interpolating id colors at feature
  // edges decodes to batch ids that don't exist (a thin draped polyline is
  // almost all edge pixels). Snap to the texel center (nearest sampling)
  // while picking.
  if (uFillQuadrants != 0) {
    int nvr_quadrant = (vOrigUv.x >= 0.5 ? 1 : 0) + (vOrigUv.y >= 0.5 ? 0 : 2);
    if ((uFillQuadrants & (1 << nvr_quadrant)) == 0) discard;
  }
  vec2 nvr_atlasUv = vOrigUv;
  if (uPickable > 0.) {
    vec2 nvr_atlasSize = vec2(textureSize(uColorAtlas, 0));
    nvr_atlasUv = (floor(vOrigUv * nvr_atlasSize) + 0.5) / nvr_atlasSize;
  }
  vec4 atlasColor = texture2D(uColorAtlas, nvr_atlasUv);
  vec4 atlasAttr  = texture2D(uAttrAtlas,  nvr_atlasUv);

  // attr.a encodes (winningSlot + 1) / 255 — 0 means no contributing slot.
  int winIdx = int(round(atlasAttr.a * 255.0)) - 1;
  // Bound + clamp the decoded index to the valid uniform-array range. A tile drawn
  // BEFORE its composite atlas is initialized samples an undefined attr.a that can
  // decode to an out-of-range winIdx. An out-of-bounds DYNAMIC array index
  // is undefined behavior that HANGS the Apple/iOS GPU with no WebGL error —
  bool hasWinner = winIdx >= 0 && winIdx < ${maxTextures};
  winIdx = clamp(winIdx, 0, ${maxTextures - 1});

  // Picking: only vector (texturized) layers carry a pickable entity.
  // attr.g is 1.0 on a vector pixel, 0.0 on a raster pixel — masking by
  // attr.g zeroes raster contribution and leaves the vector mesh's own
  // pick-shader output (composited into atlasColor via the per-layer RT
  // path) untouched. We snapshot the masked colour BEFORE the diffuse
  // merge so the final gl_FragColor override (after dithering_fragment)
  // can write the encoded batchId straight through, bypassing envmap,
  // tonemapping, colorspace, and fog — all of which would corrupt the ID.
  if (uPickable > 0.) {
    atlasColor.rgb *= atlasAttr.g;
  }
  vec3 nvr_pickColor = atlasColor.rgb;

  // atlasColor is premultiplied: the composite pass accumulates with
  //   acc = mix(acc, vec4(rgb, 1.0), alpha)
  // which gives acc.rgb = rgb*alpha + prev*(1-alpha) and acc.a tracks total
  // coverage. The "over" operator for a premultiplied source is
  //   out = src.rgb + dst * (1 - src.a)
  // — this preserves the globe's base colour where no layer wrote (atlas.a=0)
  // and matches the legacy per-slot mix(diffuse, color, alpha) semantics
  // exactly (verified algebraically for 1 and 2 stacked layers).

  bool useWater = atlasAttr.r > 0.5;
  bool isTexturizedLayer = atlasAttr.g > 0.5;

  // Per-slot uniforms indexed by the winner. Dynamic indexing of non-sampler
  // arrays is well-defined in GLSL ES 3.00. Fallbacks keep the default
  // lighting reasonable for fully-transparent pixels.
  float tileReflectivity      = hasWinner ? uReflectivities[winIdx]      : 0.0;
  float tileRoughness         = hasWinner ? uRoughnesses[winIdx]         : ${GBUFFER_PHONG_ROUGHNESS.toFixed(4)};

  // attr.r ORs the watermask into every winner's water flag, so a vector
  // winner is water only through its own flag (y). Raster winners and open
  // ocean have no wave params and are the watermask's water.
  vec2 tileWaterParams = (hasWinner && isTexturizedLayer) ? uWaterParams[winIdx] : vec2(uWaterMaskExaggeration, 1.0);
  bool tileWater = useWater && tileWaterParams.y > 0.5;
  float tileWaveExaggeration = tileWaterParams.x;
  // Water no vector layer owns is the watermask's.
  bool watermaskWater = tileWater && !(hasWinner && isTexturizedLayer);
  float tileShininess         = hasWinner ? uShininesses[winIdx]       : 0.0;
  float tileSpecularStrength  = hasWinner ? uSpecularStrengths[winIdx] : 0.0;
  bool  useSpecular           = !tileWater && hasWinner && uSpeculars[winIdx];
  float tileEmissiveIntensity = (hasWinner && isTexturizedLayer) ? uEmissiveIntensities[winIdx] : 0.0;
  vec3  tileEmissiveColor     = (hasWinner && isTexturizedLayer) ? uEmissiveColors[winIdx]      : vec3(0.0);
  float tileEffectIdsMask     = (hasWinner && isTexturizedLayer) ? uEffectIdsMasks[winIdx]      : 0.0;

  diffuseColor.rgb = atlasColor.rgb + diffuseColor.rgb * (1.0 - atlasColor.a);
  diffuseColor.rgb = mix(diffuseColor.rgb, uWaterMaskColor.rgb, watermaskWater ? uWaterMaskColor.a : 0.0);
  `;
}

/**
 * Goes in place of `#include <normal_fragment_maps>`. When the atlas carries
 * a hillshade normal, transform it tangent→view via TBN like the legacy
 * unrolled loop did, but with a single normal-atlas read. Then optionally
 * compute water/specular contribution.
 */
export function generateTileNormalFragmentMaps(
  features: TileShaderFeatures,
): string {
  const hillshadeBlock = features.hasHillshade
    ? `
    // attr-atlas normal: .a flags whether a hillshade slot won this pixel.
    vec4 atlasNormalSample = texture2D(uNormalAtlas, vOrigUv);
    if (atlasNormalSample.a > 0.5) {
      vec3 demNormal = atlasNormalSample.rgb * 2.0 - 1.0;
      demNormal = normalize(demNormal);
      demNormal.xy *= uHillshadeExaggeration;
      demNormal = normalize(demNormal);

      // Build tangent-space basis from the geometric normal (= N).
      vec3 up = vec3(0.0, 0.0, 1.0);
      vec3 T = normalize(cross(up, N));
      if (length(T) < 0.001) T = vec3(1.0, 0.0, 0.0); // pole fallback
      vec3 B = normalize(cross(N, T));
      mat3 TBN = mat3(T, B, N);

      vec3 worldDemNormal = normalize(TBN * demNormal);
      normal = normalize(mat3(viewMatrix) * worldDemNormal);
    }
    `
    : "";

  const specularBlock = `
    if (useSpecular) {
      specular = computeSpecular(
        vViewPosition,
        origNormal,
        tileShininess,
        tileSpecularStrength,
        uIor
      );
    }
    `;
  const waterBlock = hasWaterSurface(features)
    ? `
    // Outside the branch: the coordinate takes screen derivatives.
    NvrWaterCoord nvr_waterCoord = nvrWaterCoord(vViewPosition);
    NvrWaterSurface nvr_waterSurface;
    if (tileWater) {
      nvr_waterSurface = nvrWaterSurface(nvr_waterCoord, origNormal, tileWaveExaggeration, watermaskWater ? TILE_WATERMASK_WAVES : TILE_LAYER_WAVES);
    }
    `
    : "";

  return `
  #if USE_VERTEX_NORMAL && !USE_HILLSHADE
    // Keep the interpolated per-vertex normal (already in view space via three.js).
  #else
    vec3 N = normalize(vPosition);
    normal = normalize(mat3(viewMatrix) * N);
  #endif
  ${hillshadeBlock}
  vec3 origNormal = vec3(normal);
  vec3 specular = vec3(0.0);
  ${specularBlock}
  ${waterBlock}
  `;
}

/**
 * Goes after the `outgoingLight` declaration: water replaces the lit color
 * with what its surface lets through and reflects, other pixels add their
 * specular.
 */
export function generateTileOutgoingLight(
  features: TileShaderFeatures,
): string {
  return hasWaterSurface(features)
    ? `
    if (tileWater) {
      outgoingLight = nvrWaterShade(nvr_waterSurface, vViewPosition, origNormal, outgoingLight);
    } else {
      outgoingLight += specular;
    }
    `
    : "outgoingLight += specular;";
}

/** `normalBuffer = …` replacement for the MRT pass. */
export function generateTileNormalBufferReplacement(
  features: TileShaderFeatures,
): string {
  return hasWaterSurface(features)
    ? `
if (tileWater) {
  GBUFFER_WRITE_NORMAL(nvr_waterSurface.gbufferNormal, NVR_WATER_F0, nvr_waterSurface.gbufferRoughness)
} else {
  GBUFFER_WRITE_NORMAL(origNormal, tileReflectivity, tileRoughness)
}
`
    : `
GBUFFER_WRITE_NORMAL(origNormal, tileReflectivity, tileRoughness)
`;
}

/**
 * Effect/emissive write replacement, via the `GBUFFER_WRITE_EFFECT*` macros
 * from the pars chunk (each buffer's write is compiled out when the view
 * disables it). Only the texturized-layer pixels write effect/emissive;
 * raster pixels stay 0 so they don't perturb downstream effect-mask passes.
 */
export const TILE_EMISSIVE_EFFECT_BUFFER_REPLACEMENT = `
if (isTexturizedLayer) {
  GBUFFER_WRITE_EFFECT(tileEffectIdsMask, diffuseColor.rgb * tileEmissiveIntensity + tileEmissiveColor)
} else {
  GBUFFER_WRITE_EFFECT_ZERO
}
`;

/**
 * Final-stage pick override. Injected immediately AFTER
 * `#include <dithering_fragment>` (the last chunk in MeshLambert/Basic main()),
 * so the assignment to `gl_FragColor` is the last write of the fragment shader
 * — bypassing envmap, tonemapping, colorspace, and fog, all of which would
 * otherwise corrupt the encoded batchId.
 *
 * Draped vector meshes stay in their TileScene during the pick pass (see
 * PickHelper's TileScene guard) and render their own pick IDs into the
 * per-layer RT in pick mode. The composite atlas then carries those IDs
 * forward; here we write them straight through, masked by attr.g so raster
 * pixels contribute batchId=0 (no entity) instead of polluting the pick
 * buffer. `nvr_pickColor` is set up by `generateTileMapFragment`.
 */
export const TILE_PICK_FRAGMENT_OVERRIDE = `
if (uPickable > 0.) {
  gl_FragColor = vec4(nvr_pickColor, 1.0);
}
`;

/** Vertex-shader injection: passes UV and world-space position through. */
export const TILE_VERTEX_INJECTIONS = {
  afterCommon: `
varying vec2 vOrigUv;
varying vec3 vPosition;
`,
  afterUvVertex: `
vOrigUv = vUv;
`,
  afterEnvmapVertex: `
vPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
`,
};
