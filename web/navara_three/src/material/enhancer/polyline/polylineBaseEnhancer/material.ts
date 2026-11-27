import { ShaderMaterial } from "three";

import type { ShaderName } from "../../MaterialEnhancer";

import { drawsTranslucent } from "./state";
import type { PolylineBaseProps, PolylineBaseState } from "./types";

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
  state: PolylineBaseState,
): void {
  // Texturized (drape-baked) materials must render alpha-blended: with
  // blending disabled, a sub-1 alpha (per-feature opacity) lands STRAIGHT in
  // the drape target, while blended content and MSAA coverage land
  // premultiplied — and the bake's resolve divide assumes premultiplied
  // everywhere (see TileTextureCompositor's msaaResolveMaterial).
  // A blurred edge has an alpha below 1 too, which only blending draws.
  const transparent = state.isTexturized || drawsTranslucent(state);
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    // three compiles `transparent` into the program (`OPAQUE`).
    material.needsUpdate = true;
  }
  if (props.opacity !== undefined) {
    material.opacity = props.opacity;
  }
  if (props.depthWrite !== undefined) {
    material.depthWrite = props.depthWrite;
  }
}
