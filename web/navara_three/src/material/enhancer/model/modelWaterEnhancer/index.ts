import { defaults } from "lodash-es";
import type { WebGLProgramParametersWithUniforms } from "three";
import invariant from "tiny-invariant";

import type { MaterialEnhancer } from "../../MaterialEnhancer";
import {
  applyWaterMaterialConfig,
  createWaterMutates,
  DEFAULT_WATER_PROPS,
  DEFAULT_WATER_STATE,
  updateWaterState,
} from "../../water";
import type {
  ModelBaseMutates,
  ModelBaseProps,
  ModelBaseState,
  SupportedMaterial,
} from "../modelBaseEnhancer";

import {
  AVAILABLE_SHADERS,
  type SupportedMaterial as WaterSupportedMaterial,
} from "./material";
import { transformWaterShader } from "./shader";
import type {
  ModelWaterCombinedMutates,
  ModelWaterCombinedStates,
  ModelWaterMutates,
  ModelWaterOnlyProps,
  ModelWaterProps,
  ModelWaterState,
} from "./types";

/**
 * Factory function to create a model water enhancer.
 *
 * @param baseEnhancer - The base model enhancer to compose with (material is obtained from this)
 * @returns A new MaterialEnhancer with combined base + water functionality
 */
export function createModelWaterEnhancer(
  baseEnhancer: MaterialEnhancer<
    SupportedMaterial,
    ModelBaseProps,
    ModelBaseState,
    ModelBaseMutates,
    typeof AVAILABLE_SHADERS
  >,
): MaterialEnhancer<
  WaterSupportedMaterial,
  ModelWaterProps,
  ModelWaterCombinedStates,
  ModelWaterCombinedMutates,
  typeof AVAILABLE_SHADERS
> {
  const { material } = baseEnhancer;
  // Internal state - immutable, always replaced as a whole
  let state: ModelWaterState | null = null;
  // Internal mutates object (refs are hidden inside)
  let mutates: ModelWaterMutates | null = null;

  return {
    material: material as WaterSupportedMaterial,
    availableShaders: AVAILABLE_SHADERS,

    transformShader: (shader: WebGLProgramParametersWithUniforms): void => {
      invariant(
        state && mutates,
        "mount() must be called before transformShader",
      );
      // First apply base transformations
      baseEnhancer.transformShader(shader);
      // Then apply water transformations
      transformWaterShader(shader, state, mutates);
    },

    mount: (props: ModelWaterProps): void => {
      // Mount base enhancer first with base props
      baseEnhancer.mount(props.base ?? {});

      // Initialize water state and mutates with water props
      const waterProps = props.water ?? {};
      const mergedWaterProps = defaults({}, waterProps, DEFAULT_WATER_PROPS);
      state = updateWaterState(mergedWaterProps, DEFAULT_WATER_STATE);
      // Create mutates (refs are created inside with default values)
      mutates = createWaterMutates();
      mutates.update(state);
      if (waterProps.getWaterState) {
        mutates.setWaterState(waterProps.getWaterState);
      }

      // Apply material configuration (side effect)
      applyWaterMaterialConfig(
        material as WaterSupportedMaterial,
        state,
        false,
      );
    },

    update: (props: ModelWaterProps): void => {
      // Update base enhancer first with base props
      if (props.base) {
        baseEnhancer.update(props.base);
      }

      invariant(state && mutates, "mount() must be called before update");

      // Update water state and refs with water props
      if (props.water) {
        const prevUseWater = state.useWater;
        state = updateWaterState(props.water, state);
        mutates.update(state);
        if (props.water.getWaterState) {
          mutates.setWaterState(props.water.getWaterState);
        }

        // Apply material configuration (side effect)
        applyWaterMaterialConfig(
          material as WaterSupportedMaterial,
          state,
          prevUseWater,
        );
      }
    },

    states: (): ModelWaterCombinedStates => {
      invariant(state, "mount() must be called before states");
      return {
        base: baseEnhancer.states(),
        water: state,
      };
    },

    mutates: (): ModelWaterCombinedMutates => {
      invariant(mutates, "mount() must be called before mutates");
      return {
        base: baseEnhancer.mutates(),
        water: mutates,
      };
    },

    programCacheKey: (): string => {
      invariant(state, "mount() must be called before programCacheKey");
      // Combine base cache key with water-specific state
      return (
        baseEnhancer.programCacheKey() +
        JSON.stringify({
          useWater: state.useWater,
        })
      );
    },
  };
}

// Re-export public types
export type {
  ModelWaterCombinedMutates,
  ModelWaterCombinedStates,
  ModelWaterMutates,
  ModelWaterOnlyProps,
  ModelWaterProps,
  ModelWaterState,
  AVAILABLE_SHADERS,
  SupportedMaterial,
};
