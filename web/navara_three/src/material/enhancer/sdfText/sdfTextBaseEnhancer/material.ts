import { DoubleSide, FrontSide, ShaderMaterial } from "three";

import type { ShaderName } from "../../MaterialEnhancer";

import type { SdfTextBaseProps } from "./types";

/**
 * Shaders that the sdfText base enhancer supports.
 * SdfText uses ShaderMaterial with custom shaders.
 */
export const AVAILABLE_SHADERS = ["shader"] satisfies ShaderName[];

/**
 * Material types that the sdfText base enhancer supports.
 */
export type SupportedMaterial = ShaderMaterial;

/**
 * Update material properties that affect the Three.js material directly.
 * These properties are not handled by shader uniforms.
 */
export function updateMaterialProps(
  material: SupportedMaterial,
  props: SdfTextBaseProps,
): void {
  if (props.depthTest !== undefined) {
    material.depthTest = props.depthTest;
  }
  if (props.transparent !== undefined) {
    material.transparent = props.transparent;
  }
  if (props.backfaceCulling !== undefined) {
    // Only a flat quad has a back the camera can see: the parts of a large
    // one wrapped over the horizon face away, and culling trims them there.
    // An upright quad lies in the screen plane, so this never affects it.
    material.side = props.backfaceCulling ? FrontSide : DoubleSide;
  }
}
