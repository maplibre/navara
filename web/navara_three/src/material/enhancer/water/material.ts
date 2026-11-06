import type { Material } from "three";

import type { WaterSurfaceState } from "./types";

/** Recompiles the material when its water flag changed. */
export const applyWaterMaterialConfig = (
  material: Material,
  state: WaterSurfaceState,
  prevUseWater: boolean,
): void => {
  if (state.useWater !== prevUseWater) {
    material.needsUpdate = true;
  }
};
