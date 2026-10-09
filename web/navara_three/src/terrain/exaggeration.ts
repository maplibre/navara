/**
 * Vertical exaggeration of the rendered terrain, as `[scale, relativeHeight]`:
 * the value of the `uTerrainExaggeration` shader uniform, set from the
 * engine's `terrain_exaggeration_updated` event. Heights are mapped with the
 * engine's `exaggerateTerrainHeight`, not a JS copy of the formula.
 */
export type TerrainExaggeration = readonly [
  scale: number,
  relativeHeight: number,
];

export const IDENTITY_TERRAIN_EXAGGERATION: TerrainExaggeration = [1, 0];
