import { defaults } from "lodash-es";
import type { WebGLProgramParametersWithUniforms } from "three";
import invariant from "tiny-invariant";

import type { MaterialEnhancer } from "../../MaterialEnhancer";

import {
  AVAILABLE_SHADERS,
  type SupportedMaterial,
  updateMaterialProps,
} from "./material";
import { createBaseMutates } from "./mutates";
import { transformShader } from "./shader";
import { DEFAULT_BASE_PROPS, DEFAULT_BASE_STATE, updateState } from "./state";
import type {
  InstancedSpriteBaseMutates,
  InstancedSpriteBaseProps,
  InstancedSpriteBaseState,
} from "./types";

/**
 * Factory function to create an instancedSprite base enhancer.
 *
 * This enhancer handles:
 * - Scale, center, sizeInMeters, offsetDepth
 * - Alpha test for billboard mode
 * - Picking
 * - RTE (Relative-To-Eye) support for high-precision coordinates
 * - Billboard mode with texture array
 *
 * Supports ShaderMaterial with custom instancedSprite shaders.
 *
 * @param material - The Three.js ShaderMaterial to enhance
 */
export function createInstancedSpriteBaseEnhancer(
  material: SupportedMaterial,
): MaterialEnhancer<
  SupportedMaterial,
  InstancedSpriteBaseProps,
  InstancedSpriteBaseState,
  InstancedSpriteBaseMutates,
  typeof AVAILABLE_SHADERS
> {
  // Internal state - immutable, always replaced as a whole
  let state: InstancedSpriteBaseState | null = null;
  // Internal mutates object (refs are hidden inside)
  let mutates: InstancedSpriteBaseMutates | null = null;

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

    mount: (props: InstancedSpriteBaseProps): void => {
      const mergedProps = defaults({}, props, DEFAULT_BASE_PROPS);
      // Create initial state with immutable fields from props
      const initialState = {
        ...DEFAULT_BASE_STATE,
        useRTE: mergedProps.useRTE,
        billboard: mergedProps.billboard,
      };
      state = updateState(mergedProps, initialState);
      // Create mutates (refs are created inside with default values)
      mutates = createBaseMutates(
        mergedProps.useRTE,
        mergedProps.billboard,
        mergedProps.rtcCenter,
      );
      mutates.update(state);

      // Set texture external ref if provided
      if (props.texture) {
        mutates.setTexture(props.texture);
      }
      if (props.batchDataTexture) {
        mutates.setBatchDataTexture(props.batchDataTexture);
      }

      updateMaterialProps(material, mergedProps);
    },

    update: (props: InstancedSpriteBaseProps): void => {
      invariant(state && mutates, "mount() must be called before update");

      state = updateState(props, state);
      mutates.update(state);

      if (props.texture) {
        mutates.setTexture(props.texture);
      }
      if (props.batchDataTexture) {
        mutates.setBatchDataTexture(props.batchDataTexture);
      }

      updateMaterialProps(material, props);
    },

    states: (): InstancedSpriteBaseState => {
      invariant(state, "mount() must be called before states");
      return state;
    },

    mutates: (): InstancedSpriteBaseMutates => {
      invariant(mutates, "mount() must be called before mutates");
      return mutates;
    },

    programCacheKey: (): string => {
      invariant(state, "mount() must be called before programCacheKey");
      return JSON.stringify({
        useRTE: state.useRTE,
        billboard: state.billboard,
      });
    },
  };
}

// Re-export public types
export type {
  InstancedSpriteBaseMutates,
  InstancedSpriteBaseProps,
  InstancedSpriteBaseState,
};

// Re-export SupportedMaterial for use by composing enhancers
export type { SupportedMaterial } from "./material";

// Re-export marker types for composing enhancers
export {
  INSTANCED_SPRITE_BASE_SHADER_MARKERS,
  createInstancedSpriteBaseShaderReplacer,
} from "./markers";
