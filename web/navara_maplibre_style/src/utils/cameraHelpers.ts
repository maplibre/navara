/**
 * Camera-related helper functions for MapLibre Style to Navara conversion.
 */

import type ThreeView from "@navaramap/three";

/**
 * MapLibre's tile size for zoom calculations.
 * MapLibre uses `this._tileSize = 512` in TransformHelper constructor.
 * See: maplibre-gl-js/src/geo/transform_helper.ts line 162
 */
export const MAPLIBRE_TILE_SIZE = 512;

/**
 * Convert Web Mercator zoom level to camera height above ellipsoid.
 *
 * In MapLibre, zoom defines the map scale at screen center regardless of pitch.
 * This function returns the camera height (altitude above ellipsoid) required to
 * achieve the given zoom level.
 *
 * Uses Navara engine's `zoomLevelToCameraHeight` function, which is the exact
 * inverse of the engine's `camera_zoom_level` calculation.
 *
 * @param zoom - Web Mercator zoom level (typically 0-22)
 * @param view - ThreeView instance
 * @param latDeg - Latitude in degrees (affects scale due to Web Mercator projection)
 * @param tileSizePx - Tile size for zoom calculation.
 * @param fovRad - Optional FOV override in radians. If not provided, uses camera's current FOV.
 * @returns Camera height in meters above the ellipsoid
 */
export function zoomToCameraHeight(
  zoom: number,
  view: ThreeView,
  latDeg: number,
  tileSizePx: number,
  fovRad?: number,
): number {
  // Use engine's inverse function for exact calculation
  // The engine gets FOV and viewport height from its internal state
  const height = view.zoomLevelToCameraHeight(zoom, latDeg, tileSizePx, fovRad);

  // Fallback to approximation if engine function is not available
  if (height === undefined) {
    console.warn("zoomLevelToCameraHeight not available, using approximation");

    // Used only in fallback approximation when engine is not available.
    const WGS84_SEMI_MAJOR_AXIS = 6378137;

    // Simplified approximation based on tile size
    return (WGS84_SEMI_MAJOR_AXIS * tileSizePx) / (256 * Math.pow(2, zoom));
  }

  return height;
}

/**
 * Convert MapLibre pitch to Navara pitch.
 *
 * MapLibre and Navara use different pitch conventions:
 * - MapLibre: pitch 0° = looking straight down, pitch 60° = looking towards horizon
 * - Navara: pitch -90° = looking straight down, pitch 0° = looking at horizon
 *
 * Conversion formula: navara_pitch = maplibre_pitch - 90
 *
 * @param maplibrePitch - MapLibre pitch in degrees (0 = straight down, 60 = towards horizon)
 * @returns Navara pitch in degrees (-90 = straight down, 0 = towards horizon)
 */
export function maplibrePitchToNavaraPitch(maplibrePitch: number): number {
  return maplibrePitch - 90;
}
