import type {
  WaveConditions,
  WaterState,
  WaterWaves,
  WaterWavesRef,
} from "../../../water/waterState";

import type { WaterMutates, WaterRefs, WaterSurfaceState } from "./types";

const stateConditions = (state: WaterSurfaceState): WaveConditions => ({
  strength: state.waveStrength,
  direction: state.waveDirection,
  scale: state.waterScale,
});

/**
 * Create mutation functions for a water enhancer.
 * Refs are created internally and captured via closure.
 */
export const createWaterMutates = (): WaterMutates => {
  const refs: WaterRefs = {
    uWaveExaggeration: { value: 1 },
    uShininess: { value: 0 },
    uSpecularStrength: { value: 0 },
    uSpecular: { value: false },
    uIor: { value: 1.33333 },
  };
  let getWaterState: (() => WaterState) | undefined;
  let waves: WaterWavesRef | undefined;
  let surface: WaterSurfaceState | undefined;
  // `NVR_WATER_WAVES_COUNT` is 1 outside the tile shader.
  const wavesUniform: { value: WaterWaves[] } = { value: [] };

  // Only water surfaces hold waves, so other layers add nothing to the frame.
  const syncWaves = () => {
    if (!surface?.useWater || !getWaterState) {
      waves?.dispose();
      waves = undefined;
      return;
    }
    if (waves) {
      waves.set(stateConditions(surface));
    } else {
      waves = getWaterState().createWaves(stateConditions(surface));
    }
    wavesUniform.value[0] = waves.waves;
  };

  return {
    update: (state) => {
      refs.uWaveExaggeration.value = state.waveExaggeration;
      refs.uShininess.value = state.shininess;
      refs.uSpecularStrength.value = state.specularStrength;
      refs.uSpecular.value = state.specular;
      refs.uIor.value = state.ior;
      surface = state;
      syncWaves();
    },
    updateUniforms: (uniforms) => {
      Object.assign(uniforms, refs);
      if (waves && getWaterState) {
        Object.assign(uniforms, getWaterState().uniforms, {
          nvrWaterWaves: wavesUniform,
        });
      }
    },
    setWaterState: (getter) => {
      getWaterState = getter;
      syncWaves();
    },
    waves: () => waves?.waves,
    dispose: () => {
      waves?.dispose();
      waves = undefined;
    },
  };
};
