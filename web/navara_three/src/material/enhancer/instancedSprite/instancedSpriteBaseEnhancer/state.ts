import type {
  InstancedSpriteBaseProps,
  InstancedSpriteBaseState,
} from "./types";

export const DEFAULT_BASE_PROPS: Required<
  Omit<InstancedSpriteBaseProps, "texture" | "rtcCenter" | "batchDataTexture">
> = {
  useRTE: false,
  billboard: false,
  scale: 100.0,
  center: [0.0, 0.0],
  sizeInMeters: true,
  offsetDepth: true,
  alphaTest: 0.0,
  pickable: false,
  color: 0xffffff,
  opacity: 1.0,
  addHeight: 0.0,
  effectIdsMask: 0,
  emissiveColor: 0,
  emissiveIntensity: 0,
  transparent: true,
  depthTest: true,
  atlasSize: [1.0, 1.0],
  fovRad: 1.0,
  screenHeightPx: 1080,
};

/** Default state derived from DEFAULT_BASE_PROPS */
export const DEFAULT_BASE_STATE: InstancedSpriteBaseState = {
  useRTE: DEFAULT_BASE_PROPS.useRTE,
  billboard: DEFAULT_BASE_PROPS.billboard,
  scale: DEFAULT_BASE_PROPS.scale,
  center: DEFAULT_BASE_PROPS.center,
  sizeInMeters: DEFAULT_BASE_PROPS.sizeInMeters,
  offsetDepth: DEFAULT_BASE_PROPS.offsetDepth,
  alphaTest: DEFAULT_BASE_PROPS.alphaTest,
  pickable: DEFAULT_BASE_PROPS.pickable,
  color: DEFAULT_BASE_PROPS.color,
  opacity: DEFAULT_BASE_PROPS.opacity,
  addHeight: DEFAULT_BASE_PROPS.addHeight,
  effectIdsMask: DEFAULT_BASE_PROPS.effectIdsMask,
  emissiveColor: DEFAULT_BASE_PROPS.emissiveColor,
  emissiveIntensity: DEFAULT_BASE_PROPS.emissiveIntensity,
  transparent: DEFAULT_BASE_PROPS.transparent,
  depthTest: DEFAULT_BASE_PROPS.depthTest,
  atlasSize: DEFAULT_BASE_PROPS.atlasSize,
  fovRad: DEFAULT_BASE_PROPS.fovRad,
  screenHeightPx: DEFAULT_BASE_PROPS.screenHeightPx,
};

/**
 * Update mutable state from props.
 * Props override currentState values; missing props fall back to currentState.
 * Pass DEFAULT_BASE_STATE as currentState for initial mount.
 *
 * @param props - The props to apply
 * @param currentState - The current state to use as fallback (use DEFAULT_BASE_STATE for mount)
 */
export const updateState = (
  props: InstancedSpriteBaseProps,
  currentState: InstancedSpriteBaseState,
): InstancedSpriteBaseState => {
  return {
    // Immutable after mount - always preserve current value
    useRTE: currentState.useRTE,
    billboard: currentState.billboard,
    // Mutable
    scale: props.scale ?? currentState.scale,
    center: props.center ?? currentState.center,
    sizeInMeters: props.sizeInMeters ?? currentState.sizeInMeters,
    offsetDepth: props.offsetDepth ?? currentState.offsetDepth,
    alphaTest: props.alphaTest ?? currentState.alphaTest,
    pickable: props.pickable ?? currentState.pickable,
    color: props.color ?? currentState.color,
    opacity: props.opacity ?? currentState.opacity,
    addHeight: props.addHeight ?? currentState.addHeight,
    effectIdsMask: props.effectIdsMask ?? currentState.effectIdsMask,
    emissiveColor: props.emissiveColor ?? currentState.emissiveColor,
    emissiveIntensity:
      props.emissiveIntensity ?? currentState.emissiveIntensity,
    transparent: props.transparent ?? currentState.transparent,
    depthTest: props.depthTest ?? currentState.depthTest,
    atlasSize: props.atlasSize ?? currentState.atlasSize,
    fovRad: props.fovRad ?? currentState.fovRad,
    screenHeightPx: props.screenHeightPx ?? currentState.screenHeightPx,
  };
};
