import type {
  WaterMutates,
  WaterOnlyProps,
  WaterSurfaceState,
} from "../../water";
import type {
  PolygonBaseMutates,
  PolygonBaseProps,
  PolygonBaseState,
} from "../polygonBaseEnhancer";

export type { WaterMutates, WaterOnlyProps };
export type PolygonWaterState = WaterSurfaceState;

/**
 * Combined props for the polygon water enhancer.
 * Props are explicitly separated into base and water sections for clarity.
 */
export type PolygonWaterProps = {
  base?: PolygonBaseProps;
  water?: WaterOnlyProps;
};

/**
 * Combined state for the polygon water enhancer.
 * Includes both base state and water-specific state.
 */
export type PolygonWaterCombinedStates = {
  readonly base: PolygonBaseState;
  readonly water: PolygonWaterState;
};

/**
 * Combined mutation functions for the polygon water enhancer.
 */
export type PolygonWaterCombinedMutates = {
  readonly base: PolygonBaseMutates;
  readonly water: WaterMutates;
};
