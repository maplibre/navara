import type { PolylineBaseProps, PolylineBaseState } from "./types";

export const DEFAULT_BASE_PROPS: Required<
  Omit<
    PolylineBaseProps,
    | "batchDataTexture"
    | "minMaxHeight"
    | "viewportAndPixelRatio"
    | "frustumNearFar"
    | "frustumRatio"
  >
> = {
  color: 0xffffff,
  transparent: false,
  opacity: 1.0,
  depthWrite: true,
  addHeight: 0,
  width: 1,
  maxWidth: 1000,
  isTexturized: false,
  pickable: false,
  effectIdsMask: 0,
  emissiveColor: 0,
  emissiveIntensity: 0,
  useRTE: false,
  batchColorEnabled: false,
};

/** Default state derived from DEFAULT_BASE_PROPS */
export const DEFAULT_BASE_STATE: PolylineBaseState = {
  useRTE: DEFAULT_BASE_PROPS.useRTE,
  isTexturized: DEFAULT_BASE_PROPS.isTexturized,
  pickable: DEFAULT_BASE_PROPS.pickable,
  effectIdsMask: DEFAULT_BASE_PROPS.effectIdsMask,
  emissiveColor: DEFAULT_BASE_PROPS.emissiveColor,
  emissiveIntensity: DEFAULT_BASE_PROPS.emissiveIntensity,
  minMaxHeight: [0, 0],
  addHeight: DEFAULT_BASE_PROPS.addHeight,
  width: DEFAULT_BASE_PROPS.width,
  maxWidth: DEFAULT_BASE_PROPS.maxWidth,
  color: DEFAULT_BASE_PROPS.color,
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
  props: PolylineBaseProps,
  currentState: PolylineBaseState,
): PolylineBaseState => {
  const isTexturized = props.isTexturized ?? currentState.isTexturized;

  return {
    // RTE cannot change after mount - always preserve current value
    useRTE: currentState.useRTE,
    isTexturized,
    pickable: props.pickable ?? currentState.pickable,
    effectIdsMask: props.effectIdsMask ?? currentState.effectIdsMask,
    emissiveColor: props.emissiveColor ?? currentState.emissiveColor,
    emissiveIntensity:
      props.emissiveIntensity ?? currentState.emissiveIntensity,
    minMaxHeight: props.minMaxHeight ?? currentState.minMaxHeight,
    addHeight: props.addHeight ?? currentState.addHeight,
    width: props.width ?? currentState.width,
    maxWidth: props.maxWidth ?? currentState.maxWidth,
    color: props.color ?? currentState.color,
    // batchColorEnabled can only transition from false to true, never back
    batchColorEnabled:
      currentState.batchColorEnabled || !!props.batchColorEnabled,
  };
};
