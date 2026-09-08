import GBufferParsFragmentChunk from "@shaders/glsl/chunks/gbuffer_pars_fragment.glsl";
import {
  HalfFloatType,
  NearestFilter,
  UnsignedByteType,
  type WebGLRenderTarget,
} from "three";

/**
 * TS side of the screen G-buffer (MRT) layout. Everything that touches the
 * layout goes through this module so a change stays a single-file edit; the
 * GLSL mirror is `shaders/glsl/chunks/gbuffer_pars_fragment.glsl`.
 */

/** The only attachment that always exists. The rest are packed after it. */
export const GBUFFER_TEXTURE_INDEX = {
  color: 0,
} as const;

/** Names an effect can declare in `requiredBuffers`. */
export type GBufferName =
  "normal" | "selectiveEffect" | "emissive" | "shadow" | "globeNormal";

/**
 * The subset backed by an MRT attachment. `globeNormal` is not one of them —
 * it is a separate copy target — so it must not take an attachment slot, a
 * `*_LOCATION` define, or a `MAX_DRAW_BUFFERS` slot.
 */
export const GBUFFER_ATTACHMENT_NAMES = [
  "normal",
  "selectiveEffect",
  "emissive",
  "shadow",
] as const satisfies readonly GBufferName[];

/**
 * Per-view buffer configuration. Not set by the user - derived as the union
 * of the active effects' `requiredBuffers`. A disabled buffer costs nothing:
 * neither the storage nor the shader-side writes exist. Only
 * {@link GBUFFER_ATTACHMENT_NAMES} are MRT attachments.
 */
export type GBufferOptions = {
  /**
   * The view-space normal buffer (RG=octahedral normal, B=metalness or
   * reflectivity, A=roughness *and* the blend factor). Required by every
   * normal-reading effect (aerial perspective, SSR, fog light) and, via
   * {@link globeNormal}, by draped meshes.
   */
  normal?: boolean;
  /**
   * The selective-effect id buffer (R=bitmask), required by buffer-based
   * selective effects (`selectiveBloom`, `selectiveOutline`).
   */
  selectiveEffect?: boolean;
  /**
   * The HDR emissive buffer (RGB=emissive), required by `selectiveBloom`
   * extraction.
   */
  emissive?: boolean;
  /**
   * The shadow buffer (R=directional/CSM shadow amount, 0=lit,
   * 1=fully shadowed). No built-in effect requires it – declare it from a
   * custom effect's `requiredBuffers` to read per-pixel shadowing.
   */
  shadow?: boolean;
  /**
   * The globe normal copy (the terrain's view-space normal, sampled in screen
   * space). Kept at 1x1 unless a draped mesh needs it, so an effect reading
   * `getGlobeNormalTexture()` has to declare it.
   */
  globeNormal?: boolean;
};

/** {@link GBufferOptions} with defaults applied. */
export type ResolvedGBufferOptions = Readonly<Required<GBufferOptions>>;

/** Applies defaults (all disabled) to a partial configuration. */
export function resolveGBufferOptions(
  options?: GBufferOptions,
): ResolvedGBufferOptions {
  const globeNormal = options?.globeNormal ?? false;
  return {
    // The globe normal is a copy of the normal attachment, so it cannot be
    // produced without one. Applied here so every resolved configuration is
    // self-consistent, whichever path built it.
    normal: (options?.normal ?? false) || globeNormal,
    selectiveEffect: options?.selectiveEffect ?? false,
    emissive: options?.emissive ?? false,
    shadow: options?.shadow ?? false,
    globeNormal,
  };
}

/**
 * Derives the buffer configuration for a set of effect requirements
 * (`EffectDesc.requiredBuffers` of every active effect).
 */
export function unionGBufferRequirements(
  requirements: Iterable<readonly GBufferName[]>,
): ResolvedGBufferOptions {
  const enabled: Record<GBufferName, boolean> = {
    normal: false,
    selectiveEffect: false,
    emissive: false,
    shadow: false,
    globeNormal: false,
  };
  for (const required of requirements) {
    for (const name of required) {
      enabled[name] = true;
    }
  }
  return resolveGBufferOptions(enabled);
}

/**
 * Attachment indices for one view. A disabled buffer is absent rather than a
 * placeholder, so these shift — never hardcode them.
 */
export type GBufferTextureIndex = {
  color: typeof GBUFFER_TEXTURE_INDEX.color;
  /** Present only when `buffers.normal` is enabled. */
  normal?: number;
  /** Present only when `buffers.selectiveEffect` is enabled. */
  effectIds?: number;
  /** Present only when `buffers.emissive` is enabled. */
  emissive?: number;
  /** Present only when `buffers.shadow` is enabled. */
  shadow?: number;
};

/** Computes the attachment indices for resolved `buffers` options. */
export function computeGBufferTextureIndex(
  buffers: ResolvedGBufferOptions,
): GBufferTextureIndex {
  const index: GBufferTextureIndex = { ...GBUFFER_TEXTURE_INDEX };
  let next: number = GBUFFER_TEXTURE_INDEX.color + 1;
  // Attachment order of the optional buffers. Extend here (and mirror in
  // appendOptionalGBufferAttachments) when adding a new optional buffer.
  // `globeNormal` is absent on purpose: it is not an attachment.
  for (const [option, key] of [
    ["normal", "normal"],
    ["selectiveEffect", "effectIds"],
    ["emissive", "emissive"],
    ["shadow", "shadow"],
  ] as const) {
    if (buffers[option]) {
      index[key] = next++;
    }
  }
  return index;
}

/**
 * Inject once near the top of any fragment shader rendering into the
 * G-buffer. Raw `.glsl` shaders `#include` the chunk instead.
 */
export const GBUFFER_PARS_FRAGMENT: string = GBufferParsFragmentChunk;

/** Output location of the normal buffer. Mirrored in the GLSL chunk. */
export const GBUFFER_NORMAL_LOCATION_DEFINE = "GBUFFER_NORMAL_LOCATION";
/** Enables the effectIds output. Mirrored in the GLSL chunk. */
export const USE_GBUFFER_SELECTIVE_EFFECT_DEFINE =
  "USE_GBUFFER_SELECTIVE_EFFECT";
/** Output location of the effectIds buffer. Mirrored in the GLSL chunk. */
export const GBUFFER_EFFECT_ID_LOCATION_DEFINE = "GBUFFER_EFFECT_ID_LOCATION";
/** Enables the emissive output. Mirrored in the GLSL chunk. */
export const USE_GBUFFER_EMISSIVE_DEFINE = "USE_GBUFFER_EMISSIVE";
/** Output location of the emissive buffer. Mirrored in the GLSL chunk. */
export const GBUFFER_EMISSIVE_LOCATION_DEFINE = "GBUFFER_EMISSIVE_LOCATION";
/** Enables the shadow output. Mirrored in the GLSL chunk. */
export const USE_GBUFFER_SHADOW_DEFINE = "USE_GBUFFER_SHADOW";
/** Output location of the shadow buffer. Mirrored in the GLSL chunk. */
export const GBUFFER_SHADOW_LOCATION_DEFINE = "GBUFFER_SHADOW_LOCATION";

/** Stampers iterate this so defines of disabled buffers are cleared, not left stale. */
export const GBUFFER_DEFINE_NAMES = [
  GBUFFER_NORMAL_LOCATION_DEFINE,
  USE_GBUFFER_SELECTIVE_EFFECT_DEFINE,
  GBUFFER_EFFECT_ID_LOCATION_DEFINE,
  USE_GBUFFER_EMISSIVE_DEFINE,
  GBUFFER_EMISSIVE_LOCATION_DEFINE,
  USE_GBUFFER_SHADOW_DEFINE,
  GBUFFER_SHADOW_LOCATION_DEFINE,
] as const;

/** Defines enabling the optional outputs and carrying their locations. */
export function computeGBufferDefines(
  buffers: ResolvedGBufferOptions,
): Readonly<Record<string, number>> {
  const index = computeGBufferTextureIndex(buffers);
  const defines: Record<string, number> = {};
  if (index.normal !== undefined) {
    defines[GBUFFER_NORMAL_LOCATION_DEFINE] = index.normal;
  }
  if (index.effectIds !== undefined) {
    defines[USE_GBUFFER_SELECTIVE_EFFECT_DEFINE] = 1;
    defines[GBUFFER_EFFECT_ID_LOCATION_DEFINE] = index.effectIds;
  }
  if (index.emissive !== undefined) {
    defines[USE_GBUFFER_EMISSIVE_DEFINE] = 1;
    defines[GBUFFER_EMISSIVE_LOCATION_DEFINE] = index.emissive;
  }
  if (index.shadow !== undefined) {
    defines[USE_GBUFFER_SHADOW_DEFINE] = 1;
    defines[GBUFFER_SHADOW_LOCATION_DEFINE] = index.shadow;
  }
  return defines;
}

// Write snippets. Exported rather than inlined at the injection sites because
// enhancers and the tile mesh locate the injected code by exact string match,
// so both sides must share one constant.

/**
 * `normalBuffer` write for physically-based materials (standard/physical).
 * `modelBaseEnhancer` matches/replaces this exact string.
 */
export const GBUFFER_NORMAL_WRITE_PHYSICAL =
  "GBUFFER_WRITE_NORMAL(normal, metalnessFactor, roughnessFactor)";

/**
 * `normalBuffer` write for non-physical materials (basic/lambert/phong).
 * `polygonBaseEnhancer` matches/replaces this exact string.
 */
export const GBUFFER_NORMAL_WRITE_BASIC =
  "GBUFFER_WRITE_NORMAL(normal, reflectivity, roughnessFactor)";

/**
 * Selective-effect writes for built-in `ShaderLib` materials. The tile mesh
 * replaces this by exact string match with
 * `TILE_EMISSIVE_EFFECT_BUFFER_REPLACEMENT`.
 *
 * Under `USE_BATCH_EMISSIVE` the per-feature fold replaces the whole
 * expression — mirroring the lit path, where it replaces
 * `totalEmissiveRadiance` — so per-feature `emissiveIntensity: 0` really
 * excludes a feature from bloom even when the layer's `uEmissiveIntensity`
 * would otherwise keep the diffuse term contributing.
 *
 * Effect writes are always macro invocations: the macros own the alpha, which
 * is the per-attachment blend factor rather than data (see the pars chunk).
 */
export const GBUFFER_EFFECT_WRITE_BUILTIN = `GBUFFER_WRITE_EFFECT(uEffectIdsMask, NVR_BATCH_EMISSIVE_OR(diffuseColor.rgb * uEmissiveIntensity + emissive))`;

/**
 * Selective-effect writes for custom `ShaderMaterial`
 * (emissive = (fragColor + uEmissiveColor) × intensity).
 */
export const GBUFFER_EFFECT_WRITE_SHADER_MATERIAL = `GBUFFER_WRITE_EFFECT(uEffectIdsMask, (gl_FragColor.rgb + uEmissiveColor) * uEmissiveIntensity)`;

/**
 * Selective-effect writes for materials that support the effect-id mask but
 * not emissive (LineMaterial, sprite, points).
 */
export const GBUFFER_EFFECT_WRITE_ID_ONLY = `GBUFFER_WRITE_EFFECT_ID_ONLY(uEffectIdsMask)`;

/** Non-selective default — A=0.0, so a blended mesh keeps what is behind it. */
export const GBUFFER_EFFECT_WRITE_ZERO = `GBUFFER_WRITE_EFFECT_ZERO`;

/**
 * Allocates the extra attachments in {@link computeGBufferTextureIndex} order.
 * Disabled buffers get no placeholder texture.
 */
export function createGBufferAttachments(
  renderTarget: WebGLRenderTarget,
  buffers: ResolvedGBufferOptions,
): void {
  appendOptionalGBufferAttachments(renderTarget, buffers);
}

/** Split out so `CustomRenderPass` can rebuild a target around a reused color. */
export function appendOptionalGBufferAttachments(
  renderTarget: WebGLRenderTarget,
  buffers: ResolvedGBufferOptions,
): void {
  if (buffers.normal) {
    renderTarget.textures.push(renderTarget.texture.clone());
  }

  if (buffers.selectiveEffect) {
    // Discrete bitmask data: HalfFloat is exact to 11 bits (0..2047), and
    // interpolating between two masks would invent a third.
    const effectIdsTexture = renderTarget.texture.clone();
    effectIdsTexture.type = HalfFloatType;
    effectIdsTexture.minFilter = NearestFilter;
    effectIdsTexture.magFilter = NearestFilter;
    effectIdsTexture.generateMipmaps = false;
    renderTarget.textures.push(effectIdsTexture);
  }

  if (buffers.emissive) {
    // HalfFloat keeps the HDR range bloom extraction thresholds against.
    const emissiveTexture = renderTarget.texture.clone();
    emissiveTexture.type = HalfFloatType;
    renderTarget.textures.push(emissiveTexture);
  }

  if (buffers.shadow) {
    // 8 bits is plenty for a shadow factor.
    const shadowTexture = renderTarget.texture.clone();
    shadowTexture.type = UnsignedByteType;
    renderTarget.textures.push(shadowTexture);
  }
}
