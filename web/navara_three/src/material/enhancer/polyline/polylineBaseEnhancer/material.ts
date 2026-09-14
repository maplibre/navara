import { ShaderMaterial } from "three";

import type { ShaderName } from "../../MaterialEnhancer";

import type { PolylineBaseProps } from "./types";

/**
 * Shaders that the polyline base enhancer supports.
 * Polylines use ShaderMaterial with custom shaders, not built-in shaders like lambert or phong.
 */
export const AVAILABLE_SHADERS = ["shader"] satisfies ShaderName[];

/**
 * Material types that the polyline base enhancer supports.
 * Polylines use ShaderMaterial exclusively.
 */
export type SupportedMaterial = ShaderMaterial;

/**
 * Update material properties that affect the Three.js material directly.
 * These properties are not handled by shader uniforms.
 * @param material - The material to update
 * @param props - The props to apply
 */
export function updateMaterialProps(
  material: SupportedMaterial,
  props: PolylineBaseProps,
  isTexturized: boolean,
): void {
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
  if (props.opacity !== undefined) {
    material.opacity = props.opacity;
  }
  if (props.depthWrite !== undefined) {
    material.depthWrite = props.depthWrite;
  }
}
