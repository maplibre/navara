import type {
  WaterMutates,
  WaterOnlyProps,
  WaterSurfaceState,
} from "../../water";
import type {
  ModelBaseMutates,
  ModelBaseProps,
  ModelBaseState,
} from "../modelBaseEnhancer";

export type ModelWaterOnlyProps = WaterOnlyProps;
export type ModelWaterState = WaterSurfaceState;
export type ModelWaterMutates = WaterMutates;

/**
 * Combined props for the model water enhancer.
 * Props are explicitly separated into base and water sections for clarity.
 */
export type ModelWaterProps = {
  base?: ModelBaseProps;
  water?: ModelWaterOnlyProps;
};

/**
 * Combined state for the model water enhancer.
 * Includes both base state and water-specific state.
 */
export type ModelWaterCombinedStates = {
  readonly base: ModelBaseState;
  readonly water: ModelWaterState;
};

/**
 * Combined mutation functions for the model water enhancer.
 */
export type ModelWaterCombinedMutates = {
  readonly base: ModelBaseMutates;
  readonly water: ModelWaterMutates;
};
