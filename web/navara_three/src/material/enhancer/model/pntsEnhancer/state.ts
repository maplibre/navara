import type { PntsProps, PntsState } from "./types";

export const DEFAULT_PNTS_PROPS: Required<PntsProps> = {
  color: 0,
  pointSize: 1,
  height: 0,
  geodeticNormal: { x: 0, y: 0, z: 0 },
  srgbVertexColor: false,
};

/** Default state derived from DEFAULT_PNTS_PROPS. */
export const DEFAULT_PNTS_STATE: PntsState = {
  height: DEFAULT_PNTS_PROPS.height,
  geodeticNormal: DEFAULT_PNTS_PROPS.geodeticNormal,
  srgbVertexColor: false,
};

/**
 * Update immutable state from props.
 * Props override currentState values; missing props fall back to currentState.
 */
export const updateState = (
  props: PntsProps,
  currentState: PntsState,
): PntsState => ({
  height: props.height ?? currentState.height,
  geodeticNormal: props.geodeticNormal ?? currentState.geodeticNormal,
  srgbVertexColor: !!props.srgbVertexColor,
});
