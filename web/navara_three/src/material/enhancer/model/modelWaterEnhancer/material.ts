import type { MaterialsFromShaders, ShaderName } from "../../MaterialEnhancer";

// Shaders this enhancer supports
export const AVAILABLE_SHADERS = [
  "standard",
  "physical",
] satisfies ShaderName[];
export type SupportedMaterial = MaterialsFromShaders<typeof AVAILABLE_SHADERS>;
