import type { MaterialsFromShaders, ShaderName } from "../../MaterialEnhancer";

import type { PntsProps, PntsState } from "./types";

export const AVAILABLE_SHADERS = ["points"] satisfies ShaderName[];
export type SupportedMaterial = MaterialsFromShaders<typeof AVAILABLE_SHADERS>;

/**
 * Update Three.js PointsMaterial properties from props.
 */
export const updateMaterialProps = (
  material: SupportedMaterial,
  props: PntsProps,
  state: PntsState,
): void => {
  if (props.color !== undefined) {
    material.color.set(props.color).multiply(state.baseColor);
  }
  if (props.opacity !== undefined) {
    material.opacity = props.opacity * state.baseOpacity;
  }
  if (props.transparent !== undefined) {
    if (material.transparent !== props.transparent) {
      material.transparent = props.transparent;
      // Flips the `OPAQUE` define.
      material.needsUpdate = true;
    }
  }
  if (props.depthWrite !== undefined) {
    material.depthWrite = props.depthWrite;
  }
  if (props.pointSize !== undefined) {
    material.size = props.pointSize;
  }
};
