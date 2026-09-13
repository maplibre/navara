import { encodePosition } from "@navaramap/engine-api";
import { RTE_ONE_UNIFORM } from "@navaramap/three-api";
import { Color, DataTexture, type Matrix4, Vector2, Vector3 } from "three";

import type { UniformValue } from "../../../types";

import type {
  SdfTextBaseMutates,
  SdfTextBaseRefs,
  SdfTextBaseState,
} from "./types";

/**
 * Create mutation functions for the sdfText base enhancer.
 * Refs are created internally and captured via closure.
 *
 * Every ref here is batch-wide — one material draws all of a tile-layer's
 * labels. Per-label values are read by the shader from `uLabelData`.
 *
 * @param rtcCenter - The RTC center position [x, y, z]
 */
export const createBaseMutates = (
  rtcCenter?: [number, number, number],
): SdfTextBaseMutates => {
  const refs: SdfTextBaseRefs = {
    uCenter: { value: new Vector2(0.5, 0.0) },
    uSizeInMeters: { value: true },
    uOffsetDepth: { value: true },
    uSdfThreshold: { value: 0.5 },
    uOutlineWidth: { value: 0.0 },
    uOutlineColor: { value: new Color(1, 0, 0) },
    uOutlineOpacity: { value: 1.0 },
    uShowBackground: { value: false },
    uBackgroundColor: { value: new Color(1, 0, 0) },
    uBackgroundOutlineColor: { value: new Color(1, 0, 0) },
    uBackgroundOutlineWidth: { value: 0.1 },
    uFovRad: { value: 1.0 },
    uScreenHeightPx: { value: 1080.0 },
    uFarPlane: { value: 1000.0 },
    uRTCCenter: {
      value: new Vector3(
        rtcCenter?.[0] ?? 0,
        rtcCenter?.[1] ?? 0,
        rtcCenter?.[2] ?? 0,
      ),
    },
    uRTCCenterView: { value: new Vector3(0, 0, 0) },
    uEyeRTELow: { value: new Vector3(0, 0, 0) },
    uEyeRTEHigh: { value: new Vector3(0, 0, 0) },
    nvr_uPickable: { value: 0.0 },
    uEffectIdsMask: { value: 0 },
    uEmissiveColor: { value: new Color(0, 0, 0) },
    uEmissiveIntensity: { value: 0 },
    uAtlas: { value: null },
    uColorAtlas: { value: null },
    // Default to 1.0 to avoid divide-by-zero in the shader before a texture
    // is bound; UVs are unused until glyph quads exist anyway.
    uSdfAtlasSize: { value: new Vector2(1, 1) },
    uColorAtlasSize: { value: new Vector2(1, 1) },
    uLabelData: { value: null },
    // Non-zero so the shader's `i % width` / `i / width` never divide by zero
    // before the mesh binds its label texture.
    uLabelTexSize: { value: new Vector2(1, 1) },
  };

  return {
    update: (state: SdfTextBaseState) => {
      refs.uCenter.value.set(state.center[0], state.center[1]);
      refs.uSizeInMeters.value = state.sizeInMeters;
      refs.uOffsetDepth.value = state.offsetDepth;
      refs.uOutlineWidth.value = state.outlineWidth;
      refs.uOutlineColor.value.set(state.outlineColor);
      refs.uOutlineOpacity.value = state.outlineOpacity;
      refs.uShowBackground.value = state.showBackground;
      refs.uBackgroundColor.value.set(state.backgroundColor);
      refs.uBackgroundOutlineColor.value.set(state.backgroundOutlineColor);
      refs.uBackgroundOutlineWidth.value = state.backgroundOutlineWidth;
      refs.nvr_uPickable.value = state.pickable ? 1.0 : 0.0;
      refs.uEffectIdsMask.value = state.effectIdsMask;
      refs.uEmissiveColor.value.set(state.emissiveColor);
      refs.uEmissiveIntensity.value = state.emissiveIntensity;
    },

    updateUniforms: (uniforms) => {
      uniforms.uCenter = refs.uCenter;
      uniforms.uSizeInMeters = refs.uSizeInMeters;
      uniforms.uOffsetDepth = refs.uOffsetDepth;
      uniforms.uSdfThreshold = refs.uSdfThreshold;
      uniforms.uOutlineWidth = refs.uOutlineWidth;
      uniforms.uOutlineColor = refs.uOutlineColor;
      uniforms.uOutlineOpacity = refs.uOutlineOpacity;
      uniforms.uShowBackground = refs.uShowBackground;
      uniforms.uBackgroundColor = refs.uBackgroundColor;
      uniforms.uBackgroundOutlineColor = refs.uBackgroundOutlineColor;
      uniforms.uBackgroundOutlineWidth = refs.uBackgroundOutlineWidth;
      uniforms.uFovRad = refs.uFovRad;
      uniforms.uScreenHeightPx = refs.uScreenHeightPx;
      uniforms.uFarPlane = refs.uFarPlane;
      uniforms.uRTCCenter = refs.uRTCCenter;
      uniforms.uRTCCenterView = refs.uRTCCenterView;
      uniforms.uEyeRTELow = refs.uEyeRTELow;
      uniforms.uEyeRTEHigh = refs.uEyeRTEHigh;
      uniforms.u_rteOne = RTE_ONE_UNIFORM;
      uniforms.nvr_uPickable = refs.nvr_uPickable;
      uniforms.uEffectIdsMask = refs.uEffectIdsMask;
      uniforms.uEmissiveColor = refs.uEmissiveColor;
      uniforms.uEmissiveIntensity = refs.uEmissiveIntensity;
      uniforms.uAtlas = refs.uAtlas;
      uniforms.uColorAtlas = refs.uColorAtlas;
      uniforms.uSdfAtlasSize = refs.uSdfAtlasSize;
      uniforms.uColorAtlasSize = refs.uColorAtlasSize;
      uniforms.uLabelData = refs.uLabelData;
      uniforms.uLabelTexSize = refs.uLabelTexSize;
      if (refs.batchDataTexture) {
        uniforms.batchDataTexture = refs.batchDataTexture;
      }
    },

    updatePerFrame: (
      fovRad: number,
      screenHeightPx: number,
      farPlane: number,
      cameraX: number,
      cameraY: number,
      cameraZ: number,
      viewMatrix: Matrix4,
      state: SdfTextBaseState,
    ) => {
      refs.uFovRad.value = fovRad;
      refs.uScreenHeightPx.value = screenHeightPx;
      refs.uFarPlane.value = farPlane;

      if (state.useRTE) {
        const encoded = encodePosition(cameraX, cameraY, cameraZ);
        refs.uEyeRTELow.value.set(encoded.low.x, encoded.low.y, encoded.low.z);
        refs.uEyeRTEHigh.value.set(
          encoded.high.x,
          encoded.high.y,
          encoded.high.z,
        );
      } else {
        // Transform the RTC center into view space here (JS numbers are
        // float64), so the shader receives a small, precise value instead of
        // doing `viewMatrix * uRTCCenter` where both operands are ~6.4e6 in
        // float32 — the source of the jitter.
        refs.uRTCCenterView.value
          .copy(refs.uRTCCenter.value)
          .applyMatrix4(viewMatrix);
      }
    },

    setAtlasTexture: (texture: UniformValue<DataTexture | null>) => {
      refs.uAtlas.value = texture.value;
    },

    setColorAtlasTexture: (texture: UniformValue<DataTexture | null>) => {
      refs.uColorAtlas.value = texture.value;
    },

    updateAtlasSizes: () => {
      const sdfImg = refs.uAtlas.value?.image;
      if (sdfImg && sdfImg.width > 0 && sdfImg.height > 0) {
        refs.uSdfAtlasSize.value.set(sdfImg.width, sdfImg.height);
      }
      const colorImg = refs.uColorAtlas.value?.image;
      if (colorImg && colorImg.width > 0 && colorImg.height > 0) {
        refs.uColorAtlasSize.value.set(colorImg.width, colorImg.height);
      }
    },

    setLabelDataTexture: (
      texture: DataTexture | null,
      width: number,
      height: number,
    ) => {
      refs.uLabelData.value = texture;
      // Guard against a zero size reaching the shader's modulo/divide.
      refs.uLabelTexSize.value.set(Math.max(1, width), Math.max(1, height));
    },

    setRtcCenter: (center: [number, number, number]) => {
      refs.uRTCCenter.value.set(center[0], center[1], center[2]);
    },

    setBatchDataTexture: (texture: UniformValue<DataTexture | null>) => {
      // Keep the shared ref itself: batch texture growth swaps its `.value`.
      refs.batchDataTexture = texture;
    },
  };
};
