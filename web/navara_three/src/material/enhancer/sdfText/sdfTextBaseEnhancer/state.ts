import { Color } from "three";

import {
  sdfRadiusFor,
  type SdfTextBaseProps,
  type SdfTextBaseState,
} from "./types";

const hexToColor = (hex: number): Color => {
  return new Color().setHex(hex);
};

export const DEFAULT_BASE_PROPS: Required<
  Omit<SdfTextBaseProps, "atlasTexture" | "rtcCenter">
> = {
  useRTE: false,
  useMsdf: false,
  center: [0.5, 0.0],
  sizeInMeters: true,
  offsetDepth: true,
  outlineWidth: 0,
  outlineColor: 0x000000,
  outlineOpacity: 1.0,
  showBackground: false,
  backgroundColor: 0xff0000,
  backgroundOutlineColor: 0xff0000,
  backgroundOutlineWidth: 0.1,
  pickable: false,
  effectIdsMask: 0,
  emissiveColor: 0,
  emissiveIntensity: 0,
  depthTest: true,
  transparent: true,
};

/** Default state derived from DEFAULT_BASE_PROPS */
export const DEFAULT_BASE_STATE: SdfTextBaseState = {
  useRTE: DEFAULT_BASE_PROPS.useRTE,
  useMsdf: DEFAULT_BASE_PROPS.useMsdf,
  center: DEFAULT_BASE_PROPS.center,
  sizeInMeters: DEFAULT_BASE_PROPS.sizeInMeters,
  offsetDepth: DEFAULT_BASE_PROPS.offsetDepth,
  outlineWidth:
    DEFAULT_BASE_PROPS.outlineWidth / sdfRadiusFor(DEFAULT_BASE_PROPS.useMsdf),
  outlineColor: hexToColor(DEFAULT_BASE_PROPS.outlineColor),
  outlineOpacity: DEFAULT_BASE_PROPS.outlineOpacity,
  showBackground: DEFAULT_BASE_PROPS.showBackground,
  backgroundColor: hexToColor(DEFAULT_BASE_PROPS.backgroundColor),
  backgroundOutlineColor: hexToColor(DEFAULT_BASE_PROPS.backgroundOutlineColor),
  backgroundOutlineWidth: DEFAULT_BASE_PROPS.backgroundOutlineWidth,
  pickable: DEFAULT_BASE_PROPS.pickable,
  effectIdsMask: DEFAULT_BASE_PROPS.effectIdsMask,
  emissiveColor: DEFAULT_BASE_PROPS.emissiveColor,
  emissiveIntensity: DEFAULT_BASE_PROPS.emissiveIntensity,
  depthTest: DEFAULT_BASE_PROPS.depthTest,
  transparent: DEFAULT_BASE_PROPS.transparent,
};

/**
 * Update mutable state from props.
 * Props override currentState values; missing props fall back to currentState.
 * Pass DEFAULT_BASE_STATE as currentState for initial mount.
 */
export const updateState = (
  props: SdfTextBaseProps,
  currentState: SdfTextBaseState,
): SdfTextBaseState => {
  return {
    // Immutable after mount
    useRTE: currentState.useRTE,
    useMsdf: currentState.useMsdf,
    // Mutable
    center: props.center ?? currentState.center,
    sizeInMeters: props.sizeInMeters ?? currentState.sizeInMeters,
    offsetDepth: props.offsetDepth ?? currentState.offsetDepth,
    outlineWidth:
      props.outlineWidth !== undefined
        ? props.outlineWidth / sdfRadiusFor(currentState.useMsdf)
        : currentState.outlineWidth,
    outlineColor:
      props.outlineColor !== undefined
        ? hexToColor(props.outlineColor)
        : currentState.outlineColor,
    outlineOpacity: props.outlineOpacity ?? currentState.outlineOpacity,
    showBackground: props.showBackground ?? currentState.showBackground,
    backgroundColor:
      props.backgroundColor !== undefined
        ? hexToColor(props.backgroundColor)
        : currentState.backgroundColor,
    backgroundOutlineColor:
      props.backgroundOutlineColor !== undefined
        ? hexToColor(props.backgroundOutlineColor)
        : currentState.backgroundOutlineColor,
    backgroundOutlineWidth:
      props.backgroundOutlineWidth ?? currentState.backgroundOutlineWidth,
    pickable: props.pickable ?? currentState.pickable,
    effectIdsMask: props.effectIdsMask ?? currentState.effectIdsMask,
    emissiveColor: props.emissiveColor ?? currentState.emissiveColor,
    emissiveIntensity:
      props.emissiveIntensity ?? currentState.emissiveIntensity,
    depthTest: props.depthTest ?? currentState.depthTest,
    transparent: props.transparent ?? currentState.transparent,
  };
};
