import { atlasRangePx } from "@navaramap/font";
import type { Color, DataTexture, Matrix4, Vector2, Vector3 } from "three";

import type { UniformValue } from "../../../types";
import type { Mutates } from "../../MaterialEnhancer";

/** Pixel range covered by a quality's atlas distance field; defines how
 *  outline-width pixels translate to a distance-value delta. SDF (`useMsdf=false`)
 *  uses the classic 35 px radius from `sdf_glyph_renderer`; MSDF uses
 *  `MSDF_RANGE_PX` (16 px). See [`atlasRangePx`] in `@navaramap/font`. */
export const sdfRadiusFor = (useMsdf: boolean): number => atlasRangePx(useMsdf);

/**
 * Layout of the per-label data texture (`uLabelData`).
 *
 * This is a contract between three places: the vertex shader's `nvr_readLabel`
 * (`shaders/glsl/sdfText.vert.glsl`), which receives {@link LABEL_ROWS} as a
 * define so it can't drift; the CPU-side writer
 * (`mesh/sdfText/labelData.ts`); and the mesh that fills the rows. It lives
 * here because the enhancer owns the shader.
 */
export const LabelRow = {
  /** xyz = anchor high (RTE) or RTC-relative anchor, w = reserved. */
  POSITION_HIGH: 0,
  /** xyz = anchor low (RTE only), w = reserved. */
  POSITION_LOW: 1,
  /** x = textWidth, y = textHeight, z = bgMinY, w = bgMaxY (all in ems). */
  BOX: 2,
  /**
   * x = declutterHide, y = batchId, z = show, w = batchIndex.
   * batchIndex keys the *shared batch data texture* holding the per-feature
   * style (color/opacity/size/height) — see guide/BATCH_TEXTURE.md.
   */
  STATE: 3,
} as const;

/** Texels per label. Derived from {@link LabelRow} so the two can't disagree. */
export const LABEL_ROWS = Object.keys(LabelRow).length;

/**
 * Props for the sdfText base enhancer.
 *
 * Everything here is **batch-wide**: one material draws every label in a
 * tile-layer. Per-label values (position, colour, opacity, font size, height,
 * block metrics, batch id, declutter fade) live in the label data texture
 * owned by `BatchedSdfTextMesh`, not in this state — see
 * `web/navara_three/src/mesh/sdfText/labelData.ts`.
 */
export type SdfTextBaseProps = {
  // Immutable after mount
  useRTE?: boolean;
  /** When `true` the fragment shader samples the atlas as 4-channel MTSDF
   *  (median of RGB + true SDF in alpha) instead of single-channel R8. */
  useMsdf?: boolean;

  // Mutable state
  center?: [number, number];
  sizeInMeters?: boolean;
  offsetDepth?: boolean;
  outlineWidth?: number; // raw width, converted in state via sdfRadiusFor(useMsdf)
  outlineColor?: number; // hex
  outlineOpacity?: number;
  showBackground?: boolean;
  backgroundColor?: number; // hex
  backgroundOutlineColor?: number; // hex
  backgroundOutlineWidth?: number;
  pickable?: boolean;

  // SelectiveEffect
  effectIdsMask?: number;
  emissiveColor?: number; // hex
  emissiveIntensity?: number;

  // Material properties (set directly on material, not via uniforms)
  depthTest?: boolean;
  transparent?: boolean;

  // External uniform refs / values (may change over time)
  rtcCenter?: [number, number, number];
  atlasTexture?: UniformValue<DataTexture | null>;
};

/**
 * Immutable state snapshot for the sdfText base enhancer.
 */
export type SdfTextBaseState = Readonly<{
  // Immutable after mount
  useRTE: boolean;
  useMsdf: boolean;

  // Mutable
  center: [number, number];
  sizeInMeters: boolean;
  offsetDepth: boolean;
  outlineWidth: number; // pre-converted: raw / sdfRadiusFor(useMsdf)
  outlineColor: Color;
  outlineOpacity: number;
  showBackground: boolean;
  backgroundColor: Color;
  backgroundOutlineColor: Color;
  backgroundOutlineWidth: number;
  pickable: boolean;
  effectIdsMask: number;
  emissiveColor: number;
  emissiveIntensity: number;

  // Material properties
  depthTest: boolean;
  transparent: boolean;
}>;

/**
 * Mutable references (uniforms) for the sdfText base enhancer.
 * These are shared references with shader.uniforms.
 * Internal type - not exposed externally.
 */
export type SdfTextBaseRefs = {
  uCenter: UniformValue<Vector2>;
  uSizeInMeters: UniformValue<boolean>;
  uOffsetDepth: UniformValue<boolean>;
  uSdfThreshold: UniformValue<number>;
  uOutlineWidth: UniformValue<number>;
  uOutlineColor: UniformValue<Color>;
  uOutlineOpacity: UniformValue<number>;
  uShowBackground: UniformValue<boolean>;
  uBackgroundColor: UniformValue<Color>;
  uBackgroundOutlineColor: UniformValue<Color>;
  uBackgroundOutlineWidth: UniformValue<number>;
  uFovRad: UniformValue<number>;
  uScreenHeightPx: UniformValue<number>;
  uFarPlane: UniformValue<number>;
  uRTCCenter: UniformValue<Vector3>;
  uRTCCenterView: UniformValue<Vector3>;
  uEyeRTELow: UniformValue<Vector3>;
  uEyeRTEHigh: UniformValue<Vector3>;
  /** Always 1.0 — blocks fast-math reassociation of the RTE recombination. */
  u_rteOne?: UniformValue<number>;
  nvr_uPickable: UniformValue<number>;
  uEffectIdsMask: UniformValue<number>;
  uEmissiveColor: UniformValue<Color>;
  uEmissiveIntensity: UniformValue<number>;
  uAtlas: UniformValue<DataTexture | null>;
  /** COLRv1 RGBA atlas. `null` when the font has no color glyphs. */
  uColorAtlas: UniformValue<DataTexture | null>;
  /** Current SDF atlas pixel dimensions; updated when the Rust atlas grows. */
  uSdfAtlasSize: UniformValue<Vector2>;
  /** Current color atlas pixel dimensions; updated when the color atlas grows. */
  uColorAtlasSize: UniformValue<Vector2>;
  /** Per-label state, indexed by the `labelIndex` instance attribute. Owned by
   *  the mesh and swapped wholesale when it outgrows its capacity. */
  uLabelData: UniformValue<DataTexture | null>;
  /** Dimensions of `uLabelData` in texels, for the shader's index-to-texel
   *  math. Read as an `ivec2`. */
  uLabelTexSize: UniformValue<Vector2>;
  /** Shared batch data texture ref (per-feature style); growth swaps its
   *  `.value` in place. */
  batchDataTexture?: UniformValue<DataTexture | null>;
};

export type SdfTextBaseUniforms = Partial<SdfTextBaseRefs>;

/**
 * Mutation functions for the sdfText base enhancer.
 */
export type SdfTextBaseMutates = Mutates<
  SdfTextBaseState,
  SdfTextBaseUniforms,
  {
    /**
     * Update per-frame camera uniforms (FOV, screen height, far plane, RTE eye).
     */
    updatePerFrame: (
      fovRad: number,
      screenHeightPx: number,
      farPlane: number,
      cameraX: number,
      cameraY: number,
      cameraZ: number,
      viewMatrix: Matrix4,
      state: SdfTextBaseState,
    ) => void;
    /**
     * Set the SDF atlas texture external ref.
     */
    setAtlasTexture: (texture: UniformValue<DataTexture | null>) => void;
    /**
     * Set the COLRv1 color atlas texture external ref.
     */
    setColorAtlasTexture: (texture: UniformValue<DataTexture | null>) => void;
    /**
     * Sync the atlas-size uniforms with the currently-bound atlas textures.
     * Cheap to call every frame; the shader divides glyph pixel rects by these
     * to derive UVs, so this is how atlas resizes propagate to existing meshes.
     */
    updateAtlasSizes: () => void;
    /**
     * Point the shader at the mesh's per-label data texture. Must be re-called
     * whenever the mesh grows it, since growing allocates a new texture.
     */
    setLabelDataTexture: (
      texture: DataTexture | null,
      width: number,
      height: number,
    ) => void;
    /**
     * Update the batch's RTC center (the tile transform). Only meaningful in
     * RTC mode; in RTE mode anchors carry their own high/low split.
     */
    setRtcCenter: (center: [number, number, number]) => void;
    /**
     * Set the batch data texture ref (an external ref shared with the
     * batchTexture core, whose `.value` is swapped on growth).
     */
    setBatchDataTexture: (texture: UniformValue<DataTexture | null>) => void;
  }
>;
