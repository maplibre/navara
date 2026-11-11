import type {
  CompositeShaderContributions,
  CompositeSlotContext,
} from "./types";

/**
 * Per-slot marker comment, used by unit tests to assert that a given compact
 * slot maps to the expected absolute slot + region. Exported so tests build
 * the same string the shader emits — single source of truth for the format.
 */
export const compositeSlotMarker = (
  compactSlot: number,
  absoluteSlot: number,
  isVector: boolean,
): string =>
  `// ---- compact slot ${compactSlot} (absolute slot ${absoluteSlot}, ${isVector ? "vector" : "raster"}) ----`;

/**
 * True only in vitest runs (Vite sets MODE="test"). Gates injection of
 * `compositeSlotMarker` comments into the generated shader so production
 * builds (MODE="development" | "production" | undefined for non-Vite
 * consumers) carry no debug comments at all.
 */
const EMIT_SHADER_DEBUG_COMMENTS = import.meta.env?.MODE === "test";

const emitSlotMarker = (
  compactSlot: number,
  absoluteSlot: number,
  isVector: boolean,
): string =>
  EMIT_SHADER_DEBUG_COMMENTS
    ? `  ${compositeSlotMarker(compactSlot, absoluteSlot, isVector)}`
    : "";

/**
 * Default raster sampler: a straight texture fetch tinted by the per-slot color.
 * Composite layer enhancers can override this via
 * `CompositeShaderContributions.sampleProducer` (e.g. the elevation heatmap).
 */
const defaultRasterSampleProducer = ({ k }: CompositeSlotContext): string => `
    vec4 texColor${k} = texture2D(uTextures[${k}], texUv${k}) * vec4(uColors[${k}], 1.0);`;

/**
 * Build the composite-pass fragment shader skeleton, driving the per-slot loop
 * and wiring in feature contributions from the composed layer enhancers.
 *
 * The base owns:
 *   - the `main()` scaffold + the standard local accumulators,
 *   - the core per-slot uniforms (shows/colors/opacities/textures/uv),
 *   - the compact→absolute slot mapping (baked into `winningSlot`),
 *   - the alpha-over blend and the MRT output writes.
 *
 * Everything feature-specific (hillshade, elevation heatmap, water, watermask)
 * flows in through `contributions`, so the skeleton stays expression-agnostic.
 *
 * MRT outputs (WebGL2 layout(location=…)):
 *   0: colorBuffer  — composited diffuse (RGBA)
 *   1: attrBuffer   — packed material attrs (RGBA8):
 *                       r = isWater, g = isTexturized, b = 0,
 *                       a = (winSlot + 1) / 255 — 0 means no winner
 *   2: normalBuffer — hillshade normal in [0,1]; .a = 1 when present, 0 when not.
 *                     Declared only when `writesNormal`, i.e. the target atlas
 *                     has the normal attachment.
 */
export function buildCompositeFragmentShader(
  rasterCount: number,
  vectorCount: number,
  texturizedSceneIndexFrom: number,
  contributions: CompositeShaderContributions,
  writesNormal: boolean,
): string {
  const numTextures = rasterCount + vectorCount;

  // Per-slot uniform arrays are elided when numTextures === 0 — GLSL forbids
  // zero-length arrays (`uniform int x[0];` fails to compile). Watermask-only
  // tiles (no raster + no vector layers, but a quantized-mesh watermask) still
  // need to run the shader so the watermask sample reaches attr.r.
  const slotUniforms =
    numTextures > 0
      ? `
uniform int uShows[${numTextures}];
uniform vec3 uColors[${numTextures}];
uniform float uOpacities[${numTextures}];
uniform sampler2D uTextures[${numTextures}];
uniform vec2 uLayerUvOffset[${numTextures}];
uniform vec2 uLayerUvScale[${numTextures}];
uniform int uReproject[${numTextures}];
uniform vec2 uReprojectTerrainLat[${numTextures}];
// CPU-precomputed per-slot reprojection constants (see mutates.ts):
//   .xy = (mRs, mDen) — source tile's Mercator band start + span,
//   .z  = clamp-to-top-edge flag, .w = clamp-to-bottom-edge flag (polar cap).
uniform vec4 uReprojectMerc[${numTextures}];
${contributions.slotUniformDecls}
`
      : "";

  const declUniforms = `
${slotUniforms}
${contributions.globalUniformDecls}
`;

  const sampleProducer =
    contributions.sampleProducer ?? defaultRasterSampleProducer;

  // For each compact slot k, decide texColor and (conditionally) update winning
  // slot index + per-winner attrs. The absolute slot index is baked in as a
  // GLSL int constant so the TileMesh main shader's per-slot uniform arrays
  // remain addressable by `winIdx` (= attr.a decoded). Last-writer-wins: a later
  // slot's opaque pixel overwrites the winner recorded by earlier slots.
  const slotBlocks = Array.from({ length: numTextures }, (_, k) => {
    const isVector = k >= rasterCount;
    const absSlot = isVector ? texturizedSceneIndexFrom + (k - rasterCount) : k;
    const isTexturizedConst = isVector ? "1.0" : "0.0";
    const ctx: CompositeSlotContext = { k, absSlot, isVector };

    // WebMercator-on-Geographic latitude reprojection. Applies to both raster
    // (imagery) slots and baked-vector slots: a vector layer's render target is
    // baked spanning the terrain tile's WebMercator extent, so the paste remaps
    // the latitude axis the same way (identity when the slot doesn't reproject,
    // i.e. WebMercator terrain, where uReproject[k] == 0 makes this a no-op).
    //
    // Reprojection (and therefore N:M sub-rect confinement) is the only path that
    // can drive texUv outside [0,1], so both the transcendental math and the
    // `inBounds` test live behind the `uReproject` branch — non-reprojecting slots
    // keep texUv in [0,1] by construction and pay neither cost.
    const reprojectBlock = `
    if (uReproject[${k}] == 1) {
      // Affine UV is correct in longitude but stretches latitude. Remap this
      // fragment's latitude through Mercator so it samples the source correctly.
      //
      // The only per-fragment transcendental left is mLat: it depends solely on
      // vUv.y and the (tile-wide, slot-invariant) terrain lat range, so it is
      // identical for every reprojecting slot — computed once and reused. The
      // per-slot source band (mRs, mDen) and polar-cap flags are constant per slot
      // and precomputed on the CPU (see mutates.ts), so no log/tan runs per slot.
      if (!gReprojMLatReady) {
        float lat = uReprojectTerrainLat[${k}].x
          + vUv.y * (uReprojectTerrainLat[${k}].y - uReprojectTerrainLat[${k}].x);
        gReprojMLat = log(tan(PI * 0.25 + lat * 0.5));
        gReprojMLatReady = true;
      }
      float mRs = uReprojectMerc[${k}].x;
      float mDen = uReprojectMerc[${k}].y;
      // Only reproject when the source's Mercator span is wide enough to be
      // numerically safe. For deep/upsampled tiles the span shrinks to ~1e-6 while
      // mLat/mRs are ~O(1), so (mLat-mRs)/(mRn-mRs) catastrophically cancels in
      // float32 and produces vertical-stretch noise. There the Mercator correction
      // is sub-pixel anyway, so the affine texUv.y is both correct and stable.
      if (abs(mDen) > 1e-3) {
        texUv${k}.y = (gReprojMLat - mRs) / mDen;
      }
      // Polar cap fill: WebMercator content stops at ±~85.05° but Geographic
      // terrain reaches ±90°. When this slot is the band-edge source (its
      // north/south edge sits on the WM limit), clamp the polar overshoot onto
      // that edge texel so the last available source row stretches across the cap
      // instead of being dropped by the in-bounds test below. Non-edge tiles keep
      // the normal drop.
      if (uReprojectMerc[${k}].z > 0.5) texUv${k}.y = min(texUv${k}.y, 1.0);
      if (uReprojectMerc[${k}].w > 0.5) texUv${k}.y = max(texUv${k}.y, 0.0);
      // Confine the slot to the sub-rect it actually covers. With N:M draping each
      // source tile covers only part of the terrain tile; outside its [0,1] range
      // the sampler would smear the edge texel across the rest, so drop it there.
      inBounds${k} = step(0.0, texUv${k}.x) * step(texUv${k}.x, 1.0)
                   * step(0.0, texUv${k}.y) * step(texUv${k}.y, 1.0);
    }`;

    return `
${emitSlotMarker(k, absSlot, isVector)}
  if (uShows[${k}] == 1) {
    vec2 texUv${k} = vUv * uLayerUvScale[${k}] + uLayerUvOffset[${k}];
    // 1.0 unless the reproject branch below confines this slot to a sub-rect.
    float inBounds${k} = 1.0;
${reprojectBlock}
${sampleProducer(ctx)}
${contributions.perSlotPostSample(ctx)}
    float alpha${k} = texColor${k}.a * uOpacities[${k}] * inBounds${k};
    if (alpha${k} > 0.01) {
      compositedColor = mix(compositedColor, vec4(texColor${k}.rgb, 1.0), alpha${k});
      winningSlot = ${absSlot};
      isTexturized = ${isTexturizedConst};
${contributions.perSlotOnWinner(ctx)}
    }
  }`;
  }).join("\n");

  return `
precision highp float;
precision highp int;

#include <common>

varying vec2 vUv;

${declUniforms}

${contributions.includes}

layout(location = 0) out vec4 colorBuffer;
layout(location = 1) out vec4 attrBuffer;
${writesNormal ? "layout(location = 2) out vec4 normalBuffer;" : ""}

void main() {
  vec4 compositedColor = vec4(0.0);
  int winningSlot = -1;
  float isWater = 0.0;
  float isTexturized = 0.0;

  vec3 hillshadeNormal = vec3(0.5, 0.5, 1.0); // neutral upward
  bool hasHillshadeNormal = false;

  // Shared WebMercator reprojection latitude for this fragment. The terrain lat
  // range is tile-wide, so mLat is identical across every reprojecting slot —
  // computed lazily on first use and reused by the rest (see reproject block).
  float gReprojMLat = 0.0;
  bool gReprojMLatReady = false;

${slotBlocks}

${contributions.postLoop}

  colorBuffer = compositedColor;

  // Attr.a packs the winning slot index as (idx+1)/255 — 0 means no winner.
  // Main shader: int winIdx = int(round(attr.a * 255.0)) - 1.
  attrBuffer = vec4(
    isWater,
    isTexturized,
    0.0,
    float(winningSlot + 1) / 255.0
  );

${writesNormal ? "  normalBuffer = vec4(hillshadeNormal, hasHillshadeNormal ? 1.0 : 0.0);" : ""}
}
`;
}

/**
 * Vertex shader for the composite fullscreen quad. `position` and `uv` are
 * auto-injected by three.js for ShaderMaterial — declaring them here causes
 * a redefinition error under glslVersion: GLSL3.
 */
export const COMPOSITE_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;
