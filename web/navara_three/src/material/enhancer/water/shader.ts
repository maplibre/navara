import WaterParsFragment from "@shaders/glsl/chunks/water_pars_fragment.glsl";

/** Declarations of the `WaterRefs` uniforms. */
export const WATER_REFS_UNIFORMS = `uniform float uWaveExaggeration;
uniform float uShininess;
uniform float uSpecularStrength;
uniform bool uSpecular;
uniform float uIor;`;

/**
 * Inserts the water chunk before `computeSpecular`: the chunk needs three's
 * lights pars, which precede it.
 */
export const insertWaterChunk = (fragmentShader: string): string => {
  const specularIdx = fragmentShader.indexOf("vec3 computeSpecular(");
  if (specularIdx === -1) return fragmentShader;
  return (
    fragmentShader.substring(0, specularIdx) +
    WaterParsFragment +
    "\n\n" +
    fragmentShader.substring(specularIdx)
  );
};

/** Sets or clears the `WATER` define. */
export const applyWaterDefine = (
  defines: Record<string, unknown>,
  useWater: boolean,
): void => {
  if (useWater) {
    defines.WATER = 1;
  } else {
    delete defines.WATER;
  }
};
