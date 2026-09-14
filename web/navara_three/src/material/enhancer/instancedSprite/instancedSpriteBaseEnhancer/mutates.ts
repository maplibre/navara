import { encodePosition } from "@navaramap/engine-api";
import { RTE_ONE_UNIFORM } from "@navaramap/three-api";
import {
  Color,
  type Matrix4,
  type Texture,
  Vector2 as ThreeVector2,
  Vector3 as ThreeVector3,
} from "three";

import type { UniformValue } from "../../../types";

import type {
  InstancedSpriteBaseMutates,
  InstancedSpriteBaseRefs,
  InstancedSpriteBaseState,
} from "./types";

/**
 * Create mutation functions for the instancedSprite base enhancer.
 * Refs are created internally and captured via closure.
 *
 * @param _useRTE - Whether RTE is enabled (reserved for API consistency)
 * @param billboard - Whether billboard mode is enabled (determines if texture ref is created)
 * @param rtcCenter - The RTC center position [x, y, z]
 */
export const createBaseMutates = (
  _useRTE: boolean,
  billboard: boolean,
  rtcCenter?: [number, number, number],
): InstancedSpriteBaseMutates => {
  const refs: InstancedSpriteBaseRefs = {
    uRTCCenter: {
      value: new ThreeVector3(
        rtcCenter?.[0] ?? 0,
        rtcCenter?.[1] ?? 0,
        rtcCenter?.[2] ?? 0,
      ),
    },
    uRTCCenterView: { value: new ThreeVector3(0, 0, 0) },
    uEyeRTELow: { value: new ThreeVector3(0, 0, 0) },
    uEyeRTEHigh: { value: new ThreeVector3(0, 0, 0) },
    uScale: { value: 100.0 },
    uColor: { value: new Color(1, 1, 1) },
    uOpacity: { value: 1.0 },
    uAddHeight: { value: 0.0 },
    uCenter: { value: new ThreeVector2(0, 0) },
    uSizeInMeters: { value: true },
    uOffsetDepth: { value: true },
    uAlphaTest: { value: 0.0 },
    uFarPlane: { value: 0.0 },
    uAtlasSize: { value: new ThreeVector2(1, 1) },
    nvr_uPickable: { value: 0.0 },
    uEffectIdsMask: { value: 0 },
    uEmissiveColor: { value: new Color(0, 0, 0) },
    uEmissiveIntensity: { value: 0 },
    uFovRad: { value: 1.0 },
    uScreenHeightPx: { value: 1080 },
  };

  // Conditionally create texture ref for billboard mode
  if (billboard) {
    refs.uTexture = { value: null };
  }

  return {
    update: (state: InstancedSpriteBaseState) => {
      refs.uScale.value = state.scale;
      refs.uColor.value.set(state.color);
      // uOpacity feeds fragment alpha: >1 or NaN breaks the G-buffer
      // alpha-as-blend-factor invariant (per-feature writes clamp in
      // packShowOpacity; this covers the material-level path).
      refs.uOpacity.value = Number.isFinite(state.opacity)
        ? Math.min(Math.max(state.opacity, 0), 1)
        : 1.0;
      refs.uAddHeight.value = state.addHeight;
      refs.uCenter.value.set(state.center[0], state.center[1]);
      refs.uSizeInMeters.value = state.sizeInMeters;
      refs.uOffsetDepth.value = state.offsetDepth;
      refs.uAlphaTest.value = state.alphaTest;
      refs.uAtlasSize.value.set(state.atlasSize[0], state.atlasSize[1]);
      refs.nvr_uPickable.value = state.pickable ? 1.0 : 0.0;
      refs.uEffectIdsMask.value = state.effectIdsMask;
      refs.uEmissiveColor.value.set(state.emissiveColor);
      refs.uEmissiveIntensity.value = state.emissiveIntensity;
    },

    updateUniforms: (uniforms) => {
      uniforms.uColor = refs.uColor;
      uniforms.uOpacity = refs.uOpacity;
      uniforms.uAddHeight = refs.uAddHeight;
      uniforms.uRTCCenter = refs.uRTCCenter;
      uniforms.uRTCCenterView = refs.uRTCCenterView;
      uniforms.uEyeRTELow = refs.uEyeRTELow;
      uniforms.uEyeRTEHigh = refs.uEyeRTEHigh;
      uniforms.u_rteOne = RTE_ONE_UNIFORM;
      uniforms.uScale = refs.uScale;
      uniforms.uCenter = refs.uCenter;
      uniforms.uSizeInMeters = refs.uSizeInMeters;
      uniforms.uOffsetDepth = refs.uOffsetDepth;
      uniforms.uAlphaTest = refs.uAlphaTest;
      uniforms.uFarPlane = refs.uFarPlane;
      uniforms.uAtlasSize = refs.uAtlasSize;
      uniforms.uFovRad = refs.uFovRad;
      uniforms.uScreenHeightPx = refs.uScreenHeightPx;
      uniforms.nvr_uPickable = refs.nvr_uPickable;
      uniforms.uEffectIdsMask = refs.uEffectIdsMask;
      uniforms.uEmissiveColor = refs.uEmissiveColor;
      uniforms.uEmissiveIntensity = refs.uEmissiveIntensity;

      if (refs.uTexture) {
        uniforms.uTexture = refs.uTexture;
      }

      if (refs.batchDataTexture) {
        uniforms.batchDataTexture = refs.batchDataTexture;
      }
    },

    updateRteUniforms: (
      cameraX: number,
      cameraY: number,
      cameraZ: number,
      state: InstancedSpriteBaseState,
    ) => {
      if (!state.useRTE) return;
      const encoded = encodePosition(cameraX, cameraY, cameraZ);
      refs.uEyeRTELow.value.set(encoded.low.x, encoded.low.y, encoded.low.z);
      refs.uEyeRTEHigh.value.set(
        encoded.high.x,
        encoded.high.y,
        encoded.high.z,
      );
    },

    updateRtcUniforms: (
      viewMatrix: Matrix4,
      state: InstancedSpriteBaseState,
    ) => {
      if (state.useRTE) return;
      // Transform the RTC center into view space here (JS numbers are float64),
      // so the shader receives a small, precise value instead of doing
      // `viewMatrix * uRTCCenter` where both operands are ~6.4e6 in float32.
      refs.uRTCCenterView.value
        .copy(refs.uRTCCenter.value)
        .applyMatrix4(viewMatrix);
    },

    updateFarPlane: (far: number) => {
      refs.uFarPlane.value = far;
    },

    updateFovRad: (fovRad: number) => {
      refs.uFovRad.value = fovRad;
    },

    updateScreenHeightPx: (height: number) => {
      refs.uScreenHeightPx.value = height;
    },

    setTexture: (texture: UniformValue<Texture | null>) => {
      if (refs.uTexture) {
        refs.uTexture.value = texture.value;
      }
    },

    setBatchDataTexture: (texture: UniformValue<Texture | null>) => {
      // Keep the shared ref itself: batch texture growth swaps its `.value`.
      refs.batchDataTexture = texture;
    },
  };
};
