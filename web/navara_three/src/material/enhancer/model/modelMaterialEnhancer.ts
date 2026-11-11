/**
 * Model Material Enhancer - Composed from Base + Water enhancers
 *
 * This module provides the full model material functionality by using
 * the water enhancer factory which internally composes with the base enhancer.
 */

import type { MaterialEnhancer } from "../MaterialEnhancer";

import {
  createModelBaseEnhancer,
  type ModelBaseMutates,
  type ModelBaseProps,
  type ModelBaseState,
} from "./modelBaseEnhancer";
import {
  createModelWaterEnhancer,
  type ModelWaterCombinedMutates,
  type ModelWaterCombinedStates,
  type ModelWaterOnlyProps,
  type ModelWaterProps,
  type ModelWaterState,
  type AVAILABLE_SHADERS as WATER_AVAILABLE_SHADERS,
  type SupportedMaterial as WaterSupportedMaterial,
} from "./modelWaterEnhancer";

/**
 * Combined props for the model material enhancer.
 * Props are explicitly separated into base and water sections for clarity.
 */
export type ModelMaterialProps = {
  base?: ModelBaseProps;
  water?: ModelWaterOnlyProps;
};

// Shaders this enhancer supports
type AVAILABLE_SHADERS = typeof WATER_AVAILABLE_SHADERS;
type SupportedMaterial = WaterSupportedMaterial;

/**
 * Factory function to create the model material enhancer.
 *
 * This creates a new enhancer instance with its own internal state.
 *
 * @param material - The Three.js material to enhance
 *
 * @example
 * ```typescript
 * const material = new MeshStandardMaterial();
 * const enhancer = createModelMaterialEnhancer(material);
 *
 * // Mount with separated base and water props
 * enhancer.mount({
 *   base: { color: 0xff0000, metalness: 0.5 },
 *   water: { water: true, waveExaggeration: 0.5 },
 * });
 *
 * // Get state directly via states() - refresh after updates
 * const { base, water } = enhancer.states();
 *
 * // Update props (then call states() again to get fresh state)
 * enhancer.update({ base: { height: 100 } });
 *
 * // Use transformShader for onBeforeCompile
 * material.onBeforeCompile = enhancer.transformShader;
 * ```
 */
export function createModelMaterialEnhancer(
  material: SupportedMaterial,
): MaterialEnhancer<
  SupportedMaterial,
  ModelMaterialProps,
  ModelWaterCombinedStates,
  ModelWaterCombinedMutates,
  AVAILABLE_SHADERS
> {
  const baseEnhancer = createModelBaseEnhancer(material);
  return createModelWaterEnhancer(baseEnhancer);
}

// Re-export types for convenience
export type {
  ModelBaseMutates,
  ModelBaseProps,
  ModelBaseState,
  ModelWaterCombinedMutates,
  ModelWaterCombinedStates,
  ModelWaterOnlyProps,
  ModelWaterProps,
  ModelWaterState,
};
