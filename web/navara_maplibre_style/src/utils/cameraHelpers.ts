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
 * Convert Web Mercator zoom level to camera viewing distance.
 *
 * In MapLibre, zoom defines the map scale at screen center regardless of pitch.
 * This function returns the camera viewing distance (camera-to-target distance)
 * required to achieve the given zoom level.
 *
 * Uses Navara engine's `zoomLevelToCameraDistance` function, which is the exact
 * inverse of the engine's `camera_zoom_level` calculation.
 *
 * @param zoom - Web Mercator zoom level (typically 0-22)
 * @param view - ThreeView instance
 * @param latDeg - Latitude in degrees (affects scale due to Web Mercator projection)
 * @param tileSizePx - Tile size for zoom calculation.
 * @param fovRad - Optional FOV override in radians. If not provided, uses camera's current FOV.
 * @returns Camera viewing distance to target in meters
 */
export function zoomToCameraDistance(
  zoom: number,
  view: ThreeView,
  latDeg: number,
  tileSizePx: number,
  fovRad?: number,
): number {
  // Use engine's inverse function for exact calculation
  // The engine gets FOV and viewport height from its internal state
  const distance = view.zoomLevelToCameraDistance(
    zoom,
    latDeg,
    tileSizePx,
    fovRad,
  );

  if (distance === undefined) {
    throw new Error(
      `zoomLevelToCameraDistance returned undefined for zoom=${zoom}, lat=${latDeg}`,
    );
  }

  return distance;
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
