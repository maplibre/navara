import type { MaterialsFromShaders, ShaderName } from "../../MaterialEnhancer";

import type { PolygonBaseProps } from "./types";

// Shaders this enhancer supports
export const AVAILABLE_SHADERS = ["lambert"] satisfies ShaderName[];
export type SupportedMaterial = MaterialsFromShaders<typeof AVAILABLE_SHADERS>;

/**
 * Update Three.js material properties from props and state.
 * Side effect function - mutates material directly.
 */
export const updateMaterialProps = (
  material: SupportedMaterial,
  props: PolygonBaseProps,
  isTexturized: boolean,
): void => {
  if (props.color !== undefined) {
    material.color.set(props.color);
  }
  if (props.opacity !== undefined) {
    material.opacity = props.opacity;
  }
  // Texturized (drape-baked) materials must render alpha-blended: with
  // blending disabled, a sub-1 alpha (per-feature opacity) lands STRAIGHT in
  // the drape target, while blended content and MSAA coverage land
  // premultiplied — and the bake's resolve divide assumes premultiplied
  // everywhere (see TileTextureCompositor's msaaResolveMaterial).
  if (isTexturized) {
    material.transparent = true;
  } else if (props.transparent !== undefined) {
    material.transparent = props.transparent;
  }
  if (props.wireframe !== undefined) {
    material.wireframe = props.wireframe;
  }
  if (props.emissiveColor !== undefined) {
    material.emissive.set(props.emissiveColor);
  }
  if (props.emissiveIntensity !== undefined) {
    material.emissiveIntensity = props.emissiveIntensity;
  }
  if (props.reflectivity !== undefined) {
    material.reflectivity = props.reflectivity;
  }
};
