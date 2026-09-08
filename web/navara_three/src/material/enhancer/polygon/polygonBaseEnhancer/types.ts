import type { Matrix4, Texture, Vector3 } from "three";

import type { UniformValue } from "../../../types";
import type { Mutates } from "../../MaterialEnhancer";

/**
 * Props for the polygon core enhancer.
 */
export type PolygonBaseProps = {
  // Basic material props
  color?: number;
  opacity?: number;
  transparent?: boolean;
  wireframe?: boolean;

  // Height/extrusion
  minMaxHeight?: [number, number];
  addExtrudedHeight?: number;
  addHeight?: number;

  // Clamp to ground
  clampToGround?: boolean;
  isTexturized?: boolean;

  // Picking
  pickable?: boolean;

  // Selective Effect
  effectIdsMask?: number;

  // Reflectivity
  reflectivity?: number;
  roughness?: number;

  // Emissive (for selective effects)
  emissiveColor?: number;
  emissiveIntensity?: number;

  // Batch texture
  batchDataTexture?: UniformValue<Texture | null>;

  // When batchColorEnabled is true, material.color is set to white and actual colors come from batch texture
  batchColorEnabled?: boolean;

  // RTE (Relative To Eye) support
  useRTE?: boolean;
};

/**
 * Immutable state for the polygon base enhancer.
 * This state is always replaced as a whole (never mutated).
 * Returned directly via states() - refresh after updates.
 */
export type PolygonBaseState = Readonly<{
  useRTE: boolean;
  isTexturized: boolean;
  clampToGround: boolean;
  pickable: boolean;
  emissiveColor: number;
  emissiveIntensity: number;
  effectIdsMask: number;
  minMaxHeight: [number, number] | undefined;
  addExtrudedHeight: number;
  addHeight: number;
  reflectivity: number;
  roughness: number;
  // Batch texture state - when true, material.color is white and colors come from batch texture
  batchColorEnabled: boolean;
}>;

/**
 * Mutable references (uniforms) for the polygon base enhancer.
 *
 * These are shared references with shader.uniforms and can be mutated directly
 * for efficient GPU uniform updates without shader recompilation.
 * Internal type - not exposed externally.
 */
export type PolygonBaseRefs = {
  // Core uniforms
  uMinMaxHeight: UniformValue<[number, number] | undefined>;
  uAddExtrudedHeight: UniformValue<number>;
  uAddHeight: UniformValue<number>;
  uClampToGround: UniformValue<boolean>;
  nvr_uPickable: UniformValue<number>;
  uEffectIdsMask: UniformValue<number>;
  uEmissiveIntensity: UniformValue<number>;
  uIsTexturized: UniformValue<boolean>;
  reflectivity: UniformValue<number>;
  roughness: UniformValue<number>;

  // Optional uniforms
  batchDataTexture?: UniformValue<Texture | null>;

  // RTE uniforms (only present if useRTE is true)
  modelViewMatrixRTE?: UniformValue<Matrix4>;
  u_cameraPositionHigh?: UniformValue<Vector3>;
  u_cameraPositionLow?: UniformValue<Vector3>;
  /** Always 1.0 — blocks fast-math reassociation of the RTE recombination. */
  u_rteOne?: UniformValue<number>;
};

export type PolygonBaseUniforms = Partial<PolygonBaseRefs>;

/**
 * Mutation functions for the polygon base enhancer.
 * Includes `update(state)` to sync refs from state, plus additional methods.
 */
export type PolygonBaseMutates = Mutates<
  PolygonBaseState,
  PolygonBaseUniforms,
  {
    /**
     * Update RTE (Relative-To-Eye) uniforms for high-precision rendering.
     * Call this per-frame to update the model-view matrix and camera position.
     * Does nothing if RTE is not enabled.
     *
     * @param modelViewMatrixRTE - The model-view matrix in RTE coordinates
     * @param cameraPositionHigh - High-precision component of camera position
     * @param cameraPositionLow - Low-precision component of camera position
     * @param state - PolygonBaseState
     */
    updateRteUniforms: (
      modelViewMatrixRTE: Matrix4,
      cameraPositionHigh: Vector3,
      cameraPositionLow: Vector3,
      state: PolygonBaseState,
    ) => void;
    /**
     * Set the batch data texture ref.
     * This is needed because batchDataTexture is an external ref passed via props.
     */
    setBatchDataTexture: (texture: UniformValue<Texture | null>) => void;
  }
>;
