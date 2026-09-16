import { RTE_ONE_UNIFORM } from "@navaramap/three-api";
import {
  Color as ThreeColor,
  Matrix4 as ThreeMatrix4,
  Texture,
  UniformsLib,
  Vector2 as ThreeVector2,
  Vector3 as ThreeVector3,
} from "three";

import type { UniformValue } from "../../../types";

import { DEFAULT_BASE_PROPS } from "./state";
import type {
  PolylineBaseMutates,
  PolylineBaseRefs,
  PolylineBaseState,
} from "./types";

/**
 * Default refs with initial values.
 * These are cloned in createBaseMutates and synced from state via update().
 */
const DEFAULT_BASE_REFS: PolylineBaseRefs = {
  minMaxHeightAndWidth: { value: [0, 0, 1] },
  maxWidth: { value: 10000 },
  uAddHeight: { value: 0 },
  color: { value: new ThreeColor(0xffffff) },
  nvr_uPickable: { value: 0 },
  uEffectIdsMask: { value: 0 },
  uEmissiveColor: { value: new ThreeVector3(0, 0, 0) },
  uEmissiveIntensity: { value: 0 },
  nvr_uPickingCoord: { value: new ThreeVector2(-1, -1) },
  uDrapeRtSize: { value: DEFAULT_BASE_PROPS.drapeRtSize },
};

/**
 * Create mutation functions for the polyline base enhancer.
 * Refs are created internally and captured via closure.
 *
 * @param useRTE - Whether RTE is enabled (determines if RTE refs are created)
 */
export const createBaseMutates = (useRTE: boolean): PolylineBaseMutates => {
  // Clone defaults so each enhancer instance gets independent ref objects
  const refs = structuredClone(DEFAULT_BASE_REFS) as PolylineBaseRefs;

  // Restore Three.js objects (structuredClone creates plain objects for Three.js types)
  refs.color.value = new ThreeColor(0xffffff);
  refs.uEmissiveColor.value = new ThreeVector3(0, 0, 0);
  refs.nvr_uPickingCoord.value = new ThreeVector2(-1, -1);

  // Conditionally create RTE refs (useRTE can't change after mount)
  if (useRTE) {
    refs.modelViewMatrixRTE = { value: new ThreeMatrix4() };
    refs.u_cameraPositionHigh = { value: new ThreeVector3() };
    refs.u_cameraPositionLow = { value: new ThreeVector3() };
  }

  return {
    update: (state) => {
      // Sync refs from state
      refs.minMaxHeightAndWidth.value = [
        state.minMaxHeight[0],
        state.minMaxHeight[1],
        state.width,
      ];
      refs.maxWidth.value = state.maxWidth;
      refs.uAddHeight.value = state.addHeight;
      refs.nvr_uPickable.value = state.pickable ? 1 : 0;
      refs.uEffectIdsMask.value = state.effectIdsMask;
      const c = state.emissiveColor;
      refs.uEmissiveColor.value.set(
        ((c >> 16) & 0xff) / 255,
        ((c >> 8) & 0xff) / 255,
        (c & 0xff) / 255,
      );
      refs.uEmissiveIntensity.value = state.emissiveIntensity;
      refs.uDrapeRtSize.value = state.drapeRtSize;

      // Update color uniform using Color.setHex()
      refs.color.value.setHex(state.color);
    },
    updateUniforms: (uniforms, state) => {
      // Include Three.js lighting uniforms
      Object.assign(uniforms, UniformsLib["lights"]);

      // Assign core uniform refs to shader.uniforms
      uniforms.minMaxHeightAndWidth = refs.minMaxHeightAndWidth;
      uniforms.maxWidth = refs.maxWidth;
      uniforms.uAddHeight = refs.uAddHeight;
      uniforms.color = refs.color;
      uniforms.nvr_uPickable = refs.nvr_uPickable;
      uniforms.uEffectIdsMask = refs.uEffectIdsMask;
      uniforms.uEmissiveColor = refs.uEmissiveColor;
      uniforms.uEmissiveIntensity = refs.uEmissiveIntensity;
      uniforms.nvr_uPickingCoord = refs.nvr_uPickingCoord;
      uniforms.uDrapeRtSize = refs.uDrapeRtSize;

      // RTE uniforms
      if (
        state.useRTE &&
        refs.modelViewMatrixRTE &&
        refs.u_cameraPositionHigh &&
        refs.u_cameraPositionLow
      ) {
        uniforms.u_cameraPositionHigh = refs.u_cameraPositionHigh;
        uniforms.u_cameraPositionLow = refs.u_cameraPositionLow;
        uniforms.modelViewMatrixRTE = refs.modelViewMatrixRTE;
        uniforms.u_rteOne = RTE_ONE_UNIFORM;
      }

      // Batch texture
      if (refs.batchDataTexture) {
        uniforms.batchDataTexture = refs.batchDataTexture;
      }

      // External shared uniforms
      if (refs.viewportAndPixelRatio) {
        uniforms.viewportAndPixelRatio = refs.viewportAndPixelRatio;
      }
      if (refs.frustumNearFar) {
        uniforms.frustumNearFar = refs.frustumNearFar;
      }
      if (refs.frustumRatio) {
        uniforms.frustumRatio = refs.frustumRatio;
      }
    },
    setBatchDataTexture: (texture: UniformValue<Texture | null>): void => {
      refs.batchDataTexture = texture;
    },
    setPickingCoord: (coord: ThreeVector2): void => {
      refs.nvr_uPickingCoord.value.copy(coord);
    },
    setExternalRefs: (externalRefs: {
      batchDataTexture?: UniformValue<Texture | null>;
      viewportAndPixelRatio?: {
        value: [x: number, y: number, z: number] | undefined | null;
      };
      frustumNearFar?: { value: [x: number, y: number] | undefined | null };
      frustumRatio?: {
        value: [x: number, y: number, z: number, w: number] | undefined | null;
      };
    }): void => {
      if (externalRefs.batchDataTexture) {
        refs.batchDataTexture = externalRefs.batchDataTexture;
      }
      if (externalRefs.viewportAndPixelRatio) {
        refs.viewportAndPixelRatio = externalRefs.viewportAndPixelRatio;
      }
      if (externalRefs.frustumNearFar) {
        refs.frustumNearFar = externalRefs.frustumNearFar;
      }
      if (externalRefs.frustumRatio) {
        refs.frustumRatio = externalRefs.frustumRatio;
      }
    },
    updateRteUniforms: (
      modelViewMatrixRTE: ThreeMatrix4,
      cameraPositionHigh: ThreeVector3,
      cameraPositionLow: ThreeVector3,
      state: PolylineBaseState,
    ): void => {
      if (!state.useRTE) return;
      if (refs.modelViewMatrixRTE) {
        refs.modelViewMatrixRTE.value.copy(modelViewMatrixRTE);
      }
      if (refs.u_cameraPositionHigh) {
        refs.u_cameraPositionHigh.value.copy(cameraPositionHigh);
      }
      if (refs.u_cameraPositionLow) {
        refs.u_cameraPositionLow.value.copy(cameraPositionLow);
      }
    },
  };
};
