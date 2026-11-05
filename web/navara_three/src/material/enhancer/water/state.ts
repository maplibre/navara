import {
  DEFAULT_WAVE_CONDITIONS,
  type WaterScale,
} from "../../../water/waterState";

import type { WaterOnlyProps, WaterSurfaceState } from "./types";

export const DEFAULT_WATER_PROPS: Required<
  Omit<WaterOnlyProps, "getWaterState">
> = {
  water: false,
  waveExaggeration: 1,
  waterScale: DEFAULT_WAVE_CONDITIONS.scale,
  waveStrength: DEFAULT_WAVE_CONDITIONS.strength,
  waveDirection: DEFAULT_WAVE_CONDITIONS.direction,
  shininess: 0,
  specularStrength: 0,
  specular: false,
  ior: 1.33333,
};

/** Default state derived from DEFAULT_WATER_PROPS */
export const DEFAULT_WATER_STATE: WaterSurfaceState = {
  useWater: DEFAULT_WATER_PROPS.water,
  waveExaggeration: DEFAULT_WATER_PROPS.waveExaggeration,
  waterScale: DEFAULT_WAVE_CONDITIONS.scale,
  waveStrength: DEFAULT_WATER_PROPS.waveStrength,
  waveDirection: DEFAULT_WATER_PROPS.waveDirection,
  shininess: DEFAULT_WATER_PROPS.shininess,
  specularStrength: DEFAULT_WATER_PROPS.specularStrength,
  specular: DEFAULT_WATER_PROPS.specular,
  ior: DEFAULT_WATER_PROPS.ior,
};

/**
 * Update immutable state from props.
 * Props override currentState values; missing props fall back to currentState.
 * Pass DEFAULT_WATER_STATE as currentState for initial mount.
 */
export const updateWaterState = (
  props: WaterOnlyProps,
  currentState: WaterSurfaceState,
): WaterSurfaceState => ({
  useWater: props.water ?? currentState.useWater,
  waveExaggeration: props.waveExaggeration ?? currentState.waveExaggeration,
  waterScale: (props.waterScale as WaterScale) ?? currentState.waterScale,
  waveStrength: props.waveStrength ?? currentState.waveStrength,
  waveDirection: props.waveDirection ?? currentState.waveDirection,
  shininess: props.shininess ?? currentState.shininess,
  specularStrength: props.specularStrength ?? currentState.specularStrength,
  specular: props.specular ?? currentState.specular,
  ior: props.ior ?? currentState.ior,
});
