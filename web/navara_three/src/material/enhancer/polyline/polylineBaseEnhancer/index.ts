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
  PolylineBaseMutates,
  PolylineBaseProps,
  PolylineBaseState,
} from "./types";

/**
 * Factory function to create a polyline base enhancer.
 *
 * This enhancer handles:
 * - Color (via shader uniforms)
 * - Height (minMaxHeight) and width
 * - Clamp to ground (with ground normals support)
 * - Texturized rendering (draped on terrain)
 * - Picking
 * - Batch texture attributes (color, show, height, lineWidth)
 * - RTE (Relative-To-Eye) support for high-precision coordinates
 *
 * Supports ShaderMaterial with custom polyline shaders.
 * Note: Unlike polygon materials, polylines don't support opacity/transparent/wireframe
 * as these are managed via shader uniforms and custom shader code.
 *
 * @param material - The Three.js ShaderMaterial to enhance
 */
export function createPolylineBaseEnhancer(
  material: SupportedMaterial,
): MaterialEnhancer<
  SupportedMaterial,
  PolylineBaseProps,
  PolylineBaseState,
  PolylineBaseMutates,
  typeof AVAILABLE_SHADERS
> {
  // Internal state - immutable, always replaced as a whole
  let state: PolylineBaseState | null = null;
  // Internal mutates object (refs are hidden inside)
  let mutates: PolylineBaseMutates | null = null;

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

    mount: (props: PolylineBaseProps): void => {
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
      // Set all external refs at once
      mutates.setExternalRefs({
        batchDataTexture: props.batchDataTexture,
        viewportAndPixelRatio: props.viewportAndPixelRatio,
        frustumNearFar: props.frustumNearFar,
        frustumRatio: props.frustumRatio,
      });
      updateMaterialProps(material, mergedProps);
    },

    update: (props: PolylineBaseProps): void => {
      invariant(state && mutates, "mount() must be called before update");

      // Capture previous state for shader-affecting properties
      const prevIsTexturized = state.isTexturized;

      state = updateState(props, state);
      mutates.update(state);

      // Trigger shader recompilation if shader-affecting state changed
      if (state.isTexturized !== prevIsTexturized) {
        material.needsUpdate = true;
      }

      if (props.batchDataTexture) {
        mutates.setBatchDataTexture(props.batchDataTexture);
      }

      updateMaterialProps(material, props);
    },

    states: (): PolylineBaseState => {
      invariant(state, "mount() must be called before states");
      return state;
    },

    mutates: (): PolylineBaseMutates => {
      invariant(mutates, "mount() must be called before mutates");
      return mutates;
    },

    programCacheKey: (): string => {
      invariant(state, "mount() must be called before programCacheKey");
      // Return cache key based on state that affects shader sources/defines.
      return JSON.stringify({
        isTexturized: state.isTexturized,
        useRTE: state.useRTE,
        // Custom defines that may influence shader variants
        userDataDefines: material.userData?.defines ?? undefined,
      });
    },
  };
}

// Re-export public types
export type { PolylineBaseMutates, PolylineBaseProps, PolylineBaseState };

// Re-export SupportedMaterial for use by composing enhancers
export type { SupportedMaterial } from "./material";

// Re-export marker types for composing enhancers
export {
  POLYLINE_BASE_SHADER_MARKERS,
  createPolylineBaseShaderReplacer,
} from "./markers";
