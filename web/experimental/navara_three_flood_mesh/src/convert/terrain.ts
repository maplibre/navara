/**
 * Terrain the converters take the ground height from, for a series that
 * has none, so that `loadTimeSeriesFlood` derives the depth.
 */
import type { ElevationDecoder as EngineElevationDecoder } from "@navaramap/engine-api";

/** A position in degrees. */
export type TerrainPosition = { lng: number; lat: number };

/**
 * Samples the ground height in meters above the WGS84 ellipsoid at each of
 * `positions`, one result per position in order, `height` `undefined` where
 * it is unknown. It has the shape of `sampleTerrainMostDetailed` of
 * `@navaramap/three`, so `(positions) =>
 * view.sampleTerrainMostDetailed(terrain, positions)` is one.
 */
export type TerrainSampler = (
  positions: TerrainPosition[],
) => Promise<{ height: number | undefined }[]>;

/**
 * The terrain the converters take the ground height from: a `raster-dem`
 * source, sampled as `sampleTerrainMostDetailed` does, or a `TerrainSampler`.
 */
export type Terrain = RasterDemTerrain | TerrainSampler;

/**
 * How a `raster-dem` tile's RGB turns into a height: the fields of the
 * engine's `ElevationDecoder`, as a plain object.
 */
export type ElevationDecoder = Omit<
  EngineElevationDecoder,
  "free" | typeof Symbol.dispose
>;

/**
 * The name of one of the engine's decoders, such as `"terrarium"` for
 * `ElevationDecoder.terrarium()`.
 */
export type ElevationDecoderName = {
  [
    K in keyof typeof EngineElevationDecoder
  ]: (typeof EngineElevationDecoder)[K] extends () => EngineElevationDecoder
    ? K
    : never;
}[keyof typeof EngineElevationDecoder];

/**
 * A `raster-dem` source as `addSource` of `@navaramap/three` takes it, of
 * heights above the WGS84 ellipsoid: `url` has `{z}`, `{x}` and `{y}`.
 */
export type RasterDemTerrain = {
  type: "raster-dem";
  url: string;
  /** The decoder, or the name of one of the engine's. */
  elevationDecoder: ElevationDecoder | ElevationDecoderName;
  minZoom?: number;
  maxZoom?: number;
  tms?: boolean;
};
