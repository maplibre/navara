import { DoubleSide, FrontSide, ShaderMaterial } from "three";

import type { ShaderName } from "../../MaterialEnhancer";

import type { InstancedSpriteBaseProps } from "./types";

/**
 * Shaders that the instancedSprite base enhancer supports.
 * InstancedSprites use ShaderMaterial with custom shaders.
 */
export const AVAILABLE_SHADERS = ["shader"] satisfies ShaderName[];

/**
 * Material types that the instancedSprite base enhancer supports.
 */
export type SupportedMaterial = ShaderMaterial;

/**
 * Update material properties that affect the Three.js material directly.
 * These properties are not handled by shader uniforms.
 */
export function updateMaterialProps(
  material: SupportedMaterial,
  props: InstancedSpriteBaseProps,
): void {
  if (props.transparent !== undefined) {
    material.transparent = props.transparent;
  }
  if (props.depthTest !== undefined) {
    material.depthTest = props.depthTest;
  }
  if (props.backfaceCulling !== undefined) {
    // Off by default: a quad frozen in its anchor's frame
    // (`rotateWithCamera: false`) can legitimately be viewed from behind,
    // where culling would drop it rather than show it mirrored. On, it
    // hides the parts of a flat quad wrapped over the horizon, which face
    // away from the camera. An upright camera-following quad always faces
    // the camera, so for it this changes nothing.
    material.side = props.backfaceCulling ? FrontSide : DoubleSide;
  }
}
