import { Color, type ColorRepresentation } from "three";

import type { MaterialsFromShaders, ShaderName } from "../../MaterialEnhancer";

import type { ModelBaseProps } from "./types";

// Shaders this enhancer supports
export const AVAILABLE_SHADERS = [
  "standard",
  "physical",
] satisfies ShaderName[];
export type SupportedMaterial = MaterialsFromShaders<typeof AVAILABLE_SHADERS>;

/** The color each material had before it was first tinted (the glTF base color). */
const baseColors = new WeakMap<SupportedMaterial, Color>();
const tint = new Color();

/**
 * Sets `material.color` to its own base color multiplied by `color`, so a
 * white tint keeps the glTF baseColorFactor, like the texture and vertex
 * colors that three.js already multiplies by `material.color`.
 */
export const tintBaseColor = (
  material: SupportedMaterial,
  color: ColorRepresentation,
): void => {
  let base = baseColors.get(material);
  if (!base) {
    base = material.color.clone();
    baseColors.set(material, base);
  }
  material.color.copy(base).multiply(tint.set(color));
};

/**
 * Update Three.js material properties from props.
 * Side effect function - mutates material directly.
 */
export const updateMaterialProps = (
  material: SupportedMaterial,
  props: ModelBaseProps,
): void => {
  if (props.color !== undefined) {
    tintBaseColor(material, props.color);
  }
  if (props.metalness !== undefined) {
    material.metalness = props.metalness;
  }
  if (props.roughness !== undefined) {
    material.roughness = props.roughness;
  }
  if (props.emissiveColor !== undefined) {
    material.emissive.set(props.emissiveColor);
  }
  if (props.emissiveIntensity !== undefined) {
    material.emissiveIntensity = props.emissiveIntensity;
  }
  if (props.transparent !== undefined) {
    material.transparent = props.transparent;
  }
  if (props.opacity !== undefined) {
    material.opacity = props.opacity;
  }
  if (props.depthWrite !== undefined) {
    material.depthWrite = props.depthWrite;
  }
};
