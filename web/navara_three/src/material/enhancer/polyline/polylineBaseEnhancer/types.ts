import type { Color, Matrix4, Texture, Vector2, Vector3 } from "three";

import type { UniformValue } from "../../../types";
import type { Mutates } from "../../MaterialEnhancer";

/**
 * Props for the polyline base enhancer.
 */
export type PolylineBaseProps = {
  // Basic material props
  color?: number;

  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;

  // Height/width
  minMaxHeight?: [number, number];
  addHeight?: number;
  width?: number;
  maxWidth?: number;

  isTexturized?: boolean;

  // Picking
  pickable?: boolean;

  // SelectiveEffect
  effectIdsMask?: number;
  emissiveColor?: number;
  emissiveIntensity?: number;

  // External uniforms (passed from CommonUniforms)
  // Note: These use tuple types matching CommonUniforms, not Three.js Vector types
  viewportAndPixelRatio?: {
    value: [x: number, y: number, z: number] | undefined | null;
  };
  frustumNearFar?: { value: [x: number, y: number] | undefined | null };
  frustumRatio?: {
    value: [x: number, y: number, z: number, w: number] | undefined | null;
  };

  // Batch texture
  batchDataTexture?: UniformValue<Texture | null>;

  // When batchColorEnabled is true, material.color is set to white and actual colors come from batch texture
  batchColorEnabled?: boolean;

  // RTE (Relative To Eye) support
  useRTE?: boolean;
};

/**
 * Immutable state for the polyline base enhancer.
 * This state is always replaced as a whole (never mutated).
 * Returned directly via states() - refresh after updates.
 */
export type PolylineBaseState = Readonly<{
  useRTE: boolean;
  isTexturized: boolean;
  pickable: boolean;
  effectIdsMask: number;
  emissiveColor: number;
  emissiveIntensity: number;
  minMaxHeight: [number, number];
  addHeight: number;
  width: number;
  maxWidth: number;
  color: number;
  // Batch texture state - when true, material.color is white and colors come from batch texture
  batchColorEnabled: boolean;
}>;

/**
 * Mutable references (uniforms) for the polyline base enhancer.
 *
 * These are shared references with shader.uniforms and can be mutated directly
 * for efficient GPU uniform updates without shader recompilation.
 * Internal type - not exposed externally.
 */
export type PolylineBaseRefs = {
  // Core uniforms
  minMaxHeightAndWidth: UniformValue<[number, number, number]>;
  maxWidth: UniformValue<number>;
  uAddHeight: UniformValue<number>;
  color: UniformValue<Color>;
  nvr_uPickable: UniformValue<number>;
  uEffectIdsMask: UniformValue<number>;
  uEmissiveColor: UniformValue<Vector3>;
  uEmissiveIntensity: UniformValue<number>;
  nvr_uPickingCoord: UniformValue<Vector2>;

  // Optional uniforms
  batchDataTexture?: UniformValue<Texture | null>;

  // External shared uniforms (references passed from CommonUniforms)
  // Note: These use tuple types matching CommonUniforms, not Three.js Vector types
  viewportAndPixelRatio?: {
    value: [x: number, y: number, z: number] | undefined | null;
  };
  frustumNearFar?: { value: [x: number, y: number] | undefined | null };
  frustumRatio?: {
    value: [x: number, y: number, z: number, w: number] | undefined | null;
  };

  // RTE uniforms (only present if useRTE is true)
  modelViewMatrixRTE?: UniformValue<Matrix4>;
  u_cameraPositionHigh?: UniformValue<Vector3>;
  u_cameraPositionLow?: UniformValue<Vector3>;
  /** Always 1.0 — blocks fast-math reassociation of the RTE recombination. */
  u_rteOne?: UniformValue<number>;
};

export type PolylineBaseUniforms = Partial<PolylineBaseRefs>;

/**
 * Mutation functions for the polyline base enhancer.
 * Includes `update(state)` to sync refs from state, plus additional methods.
 */
export type PolylineBaseMutates = Mutates<
  PolylineBaseState,
  PolylineBaseUniforms,
  {
    /**
     * Update RTE (Relative-To-Eye) uniforms for high-precision rendering.
     * Call this per-frame to update the model-view matrix and camera position.
     * Does nothing if RTE is not enabled.
     *
     * @param modelViewMatrixRTE - The model-view matrix in RTE coordinates
     * @param cameraPositionHigh - High-precision component of camera position
     * @param cameraPositionLow - Low-precision component of camera position
     * @param state - PolylineBaseState
     */
    updateRteUniforms: (
      modelViewMatrixRTE: Matrix4,
      cameraPositionHigh: Vector3,
      cameraPositionLow: Vector3,
      state: PolylineBaseState,
    ) => void;
    /**
     * Set the batch data texture ref.
     * This is needed because batchDataTexture is an external ref passed via props.
     */
    setBatchDataTexture: (texture: UniformValue<Texture | null>) => void;
    /**
     * Set the picking coordinate.
     * This is needed to update the picking coordinate uniform.
     */
    setPickingCoord: (coord: Vector2) => void;
    /**
     * Set external uniform references shared across materials.
     * These are typically passed from CommonUniforms and should be set once during mount.
     */
    setExternalRefs: (externalRefs: {
      batchDataTexture?: UniformValue<Texture | null>;
      viewportAndPixelRatio?: {
        value: [x: number, y: number, z: number] | undefined | null;
      };
      frustumNearFar?: { value: [x: number, y: number] | undefined | null };
      frustumRatio?: {
        value: [x: number, y: number, z: number, w: number] | undefined | null;
      };
    }) => void;
  }
>;
