export type BuildingWindowsOptions = {
  /** Share of windows that are lit on the tallest buildings, 0–1. */
  litRatio?: number;
  /** Floor pitch in meters. */
  floorHeight?: number;
  /** Window pitch along the wall in meters. */
  columnWidth?: number;
  /** Brightness multiplier of the lit windows. */
  intensity?: number;
  /**
   * Ellipsoid height of the ground in meters; floors count up from here.
   * Buildings standing on terrain need the terrain height under the view.
   */
  groundHeight?: number;
};

export const DEFAULT_BUILDING_WINDOWS_OPTIONS: Required<BuildingWindowsOptions> =
  {
    litRatio: 0.55,
    floorHeight: 3.5,
    columnWidth: 3,
    intensity: 1,
    groundHeight: 0,
  };
