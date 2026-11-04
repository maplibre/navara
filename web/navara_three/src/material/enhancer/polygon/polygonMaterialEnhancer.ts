/**
 * Polygon Material Enhancer - Composed from Base + Water enhancers
 *
 * This module provides the full polygon material functionality by using
 * the water enhancer factory which internally composes with the base enhancer.
 */

import type { MaterialEnhancer } from "../MaterialEnhancer";

import {
  createPolygonBaseEnhancer,
  type PolygonBaseMutates,
  type PolygonBaseProps,
  type PolygonBaseState,
} from "./polygonBaseEnhancer";
import {
  createPolygonWaterEnhancer,
  type PolygonWaterCombinedMutates,
  type PolygonWaterCombinedStates,
  type PolygonWaterProps,
  type PolygonWaterState,
  type WaterOnlyProps,
  type AVAILABLE_SHADERS as WATER_AVAILABLE_SHADERS,
  type SupportedMaterial as WaterSupportedMaterial,
} from "./polygonWaterEnhancer";

/**
 * Combined props for the polygon material enhancer.
 * Props are explicitly separated into base and water sections for clarity.
 */
export type PolygonMaterialProps = {
  base?: PolygonBaseProps;
  water?: WaterOnlyProps;
};

// Shaders this enhancer supports
type AVAILABLE_SHADERS = typeof WATER_AVAILABLE_SHADERS;
type SupportedMaterial = WaterSupportedMaterial;

/**
 * Factory function to create the polygon material enhancer.
 *
 * This creates a new enhancer instance with its own internal state.
 *
 * @param material - The Three.js material to enhance
 *
 * @example
 * ```typescript
 * const material = new MeshLambertMaterial();
 * const enhancer = createPolygonMaterialEnhancer(material);
 *
 * // Mount with separated base and water props
 * enhancer.mount({
 *   base: { color: 0xff0000, useRTE: true },
 *   water: { water: true, waveExaggeration: 0.5 },
 * });
 *
 * // Get state directly via states() - refresh after updates
 * const { base, water } = enhancer.states();
 *
 * // Update RTE uniforms per-frame via mutates()
 * if (base.useRTE) {
 *   const { base: baseMutates } = enhancer.mutates();
 *   baseMutates.updateRteUniforms(modelViewMatrix, cameraHigh, cameraLow);
 * }
 *
 * // Update props (then call states() again to get fresh state)
 * enhancer.update({ base: { addHeight: 100 } });
 *
 * // Use transformShader for onBeforeCompile
 * material.onBeforeCompile = enhancer.transformShader;
 * ```
 */
export function createPolygonMaterialEnhancer(
  material: SupportedMaterial,
): MaterialEnhancer<
  SupportedMaterial,
  PolygonMaterialProps,
  PolygonWaterCombinedStates,
  PolygonWaterCombinedMutates,
  AVAILABLE_SHADERS
> {
  const baseEnhancer = createPolygonBaseEnhancer(material);
  return createPolygonWaterEnhancer(baseEnhancer);
}

// Re-export types for convenience
export type {
  PolygonBaseMutates,
  PolygonBaseProps,
  PolygonBaseState,
  PolygonWaterCombinedMutates,
  PolygonWaterCombinedStates,
  PolygonWaterProps,
  PolygonWaterState,
  WaterOnlyProps,
};
