import { defaults } from "lodash-es";
import type { WebGLProgramParametersWithUniforms } from "three";
import invariant from "tiny-invariant";

import type { MaterialEnhancer } from "../../MaterialEnhancer";

import { AVAILABLE_SHADERS, type SupportedMaterial } from "./material";
import { updateMaterialProps } from "./material";
import { createBaseMutates } from "./mutates";
import { transformShader } from "./shader";
import { DEFAULT_BASE_PROPS, DEFAULT_BASE_STATE, updateState } from "./state";
import type { ModelBaseMutates, ModelBaseProps, ModelBaseState } from "./types";

/**
 * Factory function to create a model base enhancer.
 *
 * This enhancer handles:
 * - Basic material properties (color, metalness, roughness, emissive)
 * - Height (addHeight uniform)
 * - Picking
 * - Batch texture support
 * - SelectiveEffect uniforms (effectIdsMask, uEmissiveIntensity) and emissive/emissiveIntensity material syncing
 * - Shadow map depth shader
 *
 * Supports Standard and Physical materials.
 *
 * @param material - The Three.js material to enhance
 */
export function createModelBaseEnhancer(
  material: SupportedMaterial,
): MaterialEnhancer<
  SupportedMaterial,
  ModelBaseProps,
  ModelBaseState,
  ModelBaseMutates,
  typeof AVAILABLE_SHADERS
> {
  // Internal state - immutable, always replaced as a whole
  let state: ModelBaseState | null = null;
  // Internal mutates object (refs are hidden inside)
  let mutates: ModelBaseMutates | null = null;

  return {
    material,
    availableShaders: AVAILABLE_SHADERS,

    transformShader: (shader: WebGLProgramParametersWithUniforms): void => {
      invariant(
        state && mutates,
        "mount() must be called before transformShader",
      );
      transformShader(shader, state, mutates, material);
    },

    mount: (props: ModelBaseProps): void => {
      const mergedProps = defaults({}, props, DEFAULT_BASE_PROPS);
      state = updateState(mergedProps, DEFAULT_BASE_STATE);
      // Create mutates (refs are created inside with default values)
      mutates = createBaseMutates();
      mutates.update(state);
      // Handle external refs that are passed through props
      if (props.batchDataTexture) {
        mutates.setBatchDataTexture(props.batchDataTexture);
      }
      updateMaterialProps(material, mergedProps);
    },

    update: (props: ModelBaseProps): void => {
      invariant(state && mutates, "mount() must be called before update");
      state = updateState(props, state);
      mutates.update(state);
      // Handle external refs that are passed through props
      if (props.batchDataTexture) {
        mutates.setBatchDataTexture(props.batchDataTexture);
      }
      updateMaterialProps(material, props);
    },

    states: (): ModelBaseState => {
      invariant(state, "mount() must be called before states");
      return state;
    },

    mutates: (): ModelBaseMutates => {
      invariant(mutates, "mount() must be called before mutates");
      return mutates;
    },

    programCacheKey: (): string => "model",
  };
}

// Re-export public types
export type { ModelBaseMutates, ModelBaseProps, ModelBaseState };

// Re-export SupportedMaterial for use by water enhancer
export type { SupportedMaterial } from "./material";

// Re-export marker types for composing enhancers
export {
  MODEL_BASE_SHADER_MARKERS,
  createModelBaseShaderReplacer,
} from "./markers";
