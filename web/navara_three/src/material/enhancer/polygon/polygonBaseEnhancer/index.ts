import { defaults } from "lodash-es";
import type { WebGLProgramParametersWithUniforms } from "three";
import invariant from "tiny-invariant";

import type { MaterialEnhancer } from "../../MaterialEnhancer";

import { AVAILABLE_SHADERS, type SupportedMaterial } from "./material";
import { updateMaterialProps } from "./material";
import { createBaseMutates } from "./mutates";
import { transformShader } from "./shader";
import { DEFAULT_BASE_PROPS, DEFAULT_BASE_STATE, updateState } from "./state";
import type {
  PolygonBaseMutates,
  PolygonBaseProps,
  PolygonBaseState,
} from "./types";

/**
 * Factory function to create a polygon base enhancer.
 *
 * This enhancer handles:
 * - Basic material properties (color, opacity, wireframe)
 * - Height and extrusion
 * - Clamp to ground
 * - Picking
 * - Reflectivity
 * - RTE support
 *
 * Supports Lambert materials.
 *
 * @param material - The Three.js material to enhance
 */
export function createPolygonBaseEnhancer(
  material: SupportedMaterial,
): MaterialEnhancer<
  SupportedMaterial,
  PolygonBaseProps,
  PolygonBaseState,
  PolygonBaseMutates,
  typeof AVAILABLE_SHADERS
> {
  // Internal state - immutable, always replaced as a whole
  let state: PolygonBaseState | null = null;
  // Internal mutates object (refs are hidden inside)
  let mutates: PolygonBaseMutates | null = null;

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

    mount: (props: PolygonBaseProps): void => {
      const mergedProps = defaults({}, props, DEFAULT_BASE_PROPS);
      // Create initial state with useRTE from props (useRTE can't change after mount)
      const initialState = {
        ...DEFAULT_BASE_STATE,
        useRTE: mergedProps.useRTE,
      };
      state = updateState(mergedProps, initialState);
      // Create mutates (refs are created inside with default values)
      mutates = createBaseMutates(mergedProps.useRTE);
      mutates.update(state);
      // Handle external refs that are passed through props
      if (props.batchDataTexture) {
        mutates.setBatchDataTexture(props.batchDataTexture);
      }
      updateMaterialProps(material, mergedProps);
    },

    update: (props: PolygonBaseProps): void => {
      invariant(state && mutates, "mount() must be called before update");
      state = updateState(props, state);
      mutates.update(state);
      // Handle external refs that are passed through props
      if (props.batchDataTexture) {
        mutates.setBatchDataTexture(props.batchDataTexture);
      }
      updateMaterialProps(material, props);
    },

    states: (): PolygonBaseState => {
      invariant(state, "mount() must be called before states");
      return state;
    },

    mutates: (): PolygonBaseMutates => {
      invariant(mutates, "mount() must be called before mutates");
      return mutates;
    },

    programCacheKey: (): string => {
      invariant(state, "mount() must be called before programCacheKey");
      // Return cache key based on state that affects shader defines.
      return JSON.stringify({
        isTexturized: state.isTexturized,
        clampToGround: state.clampToGround,
        useRTE: state.useRTE,
      });
    },
  };
}

// Re-export public types
export type { PolygonBaseMutates, PolygonBaseProps, PolygonBaseState };

// Re-export SupportedMaterial for use by water enhancer
export type { SupportedMaterial } from "./material";

// Re-export marker types for composing enhancers
export {
  POLYGON_BASE_SHADER_MARKERS,
  createPolygonBaseShaderReplacer,
} from "./markers";
