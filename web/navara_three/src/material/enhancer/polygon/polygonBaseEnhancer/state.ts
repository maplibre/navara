import type { PolygonBaseProps, PolygonBaseState } from "./types";

export const DEFAULT_BASE_PROPS: Required<
  Omit<PolygonBaseProps, "batchDataTexture" | "minMaxHeight">
> = {
  color: 0,
  opacity: 1,
  transparent: false,
  wireframe: false,
  addExtrudedHeight: 0,
  addHeight: 0,
  clampToGround: false,
  isTexturized: false,
  pickable: false,
  effectIdsMask: 0,
  reflectivity: 0,
  roughness: 0,
  emissiveColor: 0,
  emissiveIntensity: 0,
  useRTE: false,
  batchColorEnabled: false,
};

/** Default state derived from DEFAULT_BASE_PROPS */
export const DEFAULT_BASE_STATE: PolygonBaseState = {
  useRTE: DEFAULT_BASE_PROPS.useRTE,
  isTexturized: DEFAULT_BASE_PROPS.isTexturized,
  clampToGround: DEFAULT_BASE_PROPS.clampToGround,
  pickable: DEFAULT_BASE_PROPS.pickable,
  emissiveColor: DEFAULT_BASE_PROPS.emissiveColor,
  emissiveIntensity: DEFAULT_BASE_PROPS.emissiveIntensity,
  effectIdsMask: 0,
  minMaxHeight: undefined,
  addExtrudedHeight: DEFAULT_BASE_PROPS.addExtrudedHeight,
  addHeight: DEFAULT_BASE_PROPS.addHeight,
  reflectivity: DEFAULT_BASE_PROPS.reflectivity,
  roughness: DEFAULT_BASE_PROPS.roughness,
  batchColorEnabled: DEFAULT_BASE_PROPS.batchColorEnabled,
};

/**
 * Update immutable state from props.
 * Props override currentState values; missing props fall back to currentState.
 * Pass DEFAULT_BASE_STATE as currentState for initial mount.
 *
 * @param props - The props to apply
 * @param currentState - The current state to use as fallback (use DEFAULT_BASE_STATE for mount)
 */
export const updateState = (
  props: PolygonBaseProps,
  currentState: PolygonBaseState,
): PolygonBaseState => {
  const isTexturized = props.isTexturized ?? currentState.isTexturized;

  return {
    // RTE cannot change after mount - always preserve current value
    useRTE: currentState.useRTE,
    isTexturized,
    clampToGround: props.clampToGround ?? currentState.clampToGround,
    pickable: props.pickable ?? currentState.pickable,
    emissiveColor: props.emissiveColor ?? currentState.emissiveColor,
    emissiveIntensity:
      props.emissiveIntensity ?? currentState.emissiveIntensity,
    effectIdsMask: props.effectIdsMask ?? currentState.effectIdsMask,
    minMaxHeight: props.minMaxHeight ?? currentState.minMaxHeight,
    addExtrudedHeight:
      props.addExtrudedHeight ?? currentState.addExtrudedHeight,
    addHeight: props.addHeight ?? currentState.addHeight,
    reflectivity: props.reflectivity ?? currentState.reflectivity,
    roughness: props.roughness ?? currentState.roughness,
    batchColorEnabled:
      props.batchColorEnabled ?? currentState.batchColorEnabled,
  };
};
