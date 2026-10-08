import { describe, expect, it, vi } from "vitest";

import {
  maplibrePitchToNavaraPitch,
  zoomToCameraDistance,
  MAPLIBRE_TILE_SIZE,
} from "./cameraHelpers";

// Mock ThreeView
const createMockView = (fov = 60, viewportHeight = 800) => {
  return {
    camera: { fov },
    renderer: { domElement: { height: viewportHeight } },
    zoomLevelToCameraDistance: vi.fn((zoom, lat, tileSizePx = 256, fovRad) => {
      // Simulate the engine's calculation
      // Engine uses internal viewport height and FOV
      const EARTH_RADIUS = 6378137;
      // Use provided FOV override or default to view's FOV
      const effectiveFov =
        fovRad !== undefined ? fovRad : (fov * Math.PI) / 180;
      const latRad = (lat * Math.PI) / 180;
      const earthCircumference = 2 * Math.PI * EARTH_RADIUS;
      const metersPerPixelZ0 =
        (earthCircumference * Math.cos(latRad)) / tileSizePx;
      return (
        (metersPerPixelZ0 * viewportHeight) /
        (Math.pow(2, zoom) * 2 * Math.tan(effectiveFov / 2))
      );
    }),
  } as any;
};

describe("cameraHelpers", () => {
  describe("zoomToCameraDistance", () => {
    it("should use engine's zoomLevelToCameraDistance function", () => {
      const view = createMockView();
      zoomToCameraDistance(5, view, 0, MAPLIBRE_TILE_SIZE);
      expect(view.zoomLevelToCameraDistance).toHaveBeenCalledWith(
        5,
        0,
        MAPLIBRE_TILE_SIZE,
        undefined,
      );
    });

    it("should convert zoom 0 to a very large distance", () => {
      const view = createMockView();
      const distance = zoomToCameraDistance(0, view, 0, MAPLIBRE_TILE_SIZE);
      // At zoom 0, we should see the whole Earth
      // The actual value depends on FOV and viewport, can be quite high
      expect(distance).toBeGreaterThan(50_000_000); // > 50,000 km
      expect(distance).toBeLessThan(200_000_000); // < 200,000 km
    });

    it("should convert higher zoom levels to smaller distances", () => {
      const view = createMockView();
      const distance0 = zoomToCameraDistance(0, view, 0, MAPLIBRE_TILE_SIZE);
      const distance5 = zoomToCameraDistance(5, view, 0, MAPLIBRE_TILE_SIZE);
      const distance10 = zoomToCameraDistance(10, view, 0, MAPLIBRE_TILE_SIZE);
      const distance15 = zoomToCameraDistance(15, view, 0, MAPLIBRE_TILE_SIZE);

      // Distance should decrease as zoom increases
      expect(distance5).toBeLessThan(distance0);
      expect(distance10).toBeLessThan(distance5);
      expect(distance15).toBeLessThan(distance10);
    });

    it("should account for latitude", () => {
      const view = createMockView();
      const distanceEquator = zoomToCameraDistance(
        5,
        view,
        0,
        MAPLIBRE_TILE_SIZE,
      );
      const distance45deg = zoomToCameraDistance(
        5,
        view,
        45,
        MAPLIBRE_TILE_SIZE,
      );

      // At higher latitudes, scale is different due to Web Mercator
      expect(distanceEquator).not.toBe(distance45deg);
    });

    it("should forward fovRad override and affect computed distance", () => {
      const view = createMockView(60); // Default FOV = 60 degrees
      const zoom = 5;
      const lat = 0;
      const customFov = Math.PI / 4; // 45 degrees in radians (different from default 60)

      // Call with custom FOV
      const distanceWithCustomFov = zoomToCameraDistance(
        zoom,
        view,
        lat,
        MAPLIBRE_TILE_SIZE,
        customFov,
      );

      // Verify the custom FOV was passed to the engine function
      expect(view.zoomLevelToCameraDistance).toHaveBeenCalledWith(
        zoom,
        lat,
        MAPLIBRE_TILE_SIZE,
        customFov,
      );

      // Call with default FOV (no override)
      const distanceWithDefaultFov = zoomToCameraDistance(
        zoom,
        view,
        lat,
        MAPLIBRE_TILE_SIZE,
      );

      // Verify undefined was passed when no override
      expect(view.zoomLevelToCameraDistance).toHaveBeenCalledWith(
        zoom,
        lat,
        MAPLIBRE_TILE_SIZE,
        undefined,
      );

      // Distance should differ when using different FOV values
      // Smaller FOV (45°) requires greater camera distance for same zoom level
      expect(distanceWithCustomFov).not.toBe(distanceWithDefaultFov);
      expect(distanceWithCustomFov).toBeGreaterThan(distanceWithDefaultFov);
      expect(distanceWithCustomFov).toBeGreaterThan(0);
      expect(distanceWithDefaultFov).toBeGreaterThan(0);
    });

    it("should fallback to approximation if engine function unavailable", () => {
      const view = createMockView();
      view.zoomLevelToCameraDistance = vi.fn(() => undefined);

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const distance = zoomToCameraDistance(5, view, 0, MAPLIBRE_TILE_SIZE);

      expect(consoleSpy).toHaveBeenCalledWith(
        "zoomLevelToCameraDistance not available, using approximation",
      );
      expect(distance).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });
  });

  describe("maplibrePitchToNavaraPitch", () => {
    it("should convert MapLibre pitch 0 (straight down) to Navara pitch -90", () => {
      expect(maplibrePitchToNavaraPitch(0)).toBe(-90);
    });

    it("should convert MapLibre pitch 90 (horizontal) to Navara pitch 0", () => {
      expect(maplibrePitchToNavaraPitch(90)).toBe(0);
    });

    it("should convert MapLibre pitch 60 (common angle) to Navara pitch -30", () => {
      expect(maplibrePitchToNavaraPitch(60)).toBe(-30);
    });

    it("should convert MapLibre pitch 45 to Navara pitch -45", () => {
      expect(maplibrePitchToNavaraPitch(45)).toBe(-45);
    });

    it("should handle edge cases", () => {
      // MapLibre pitch can be negative (looking up)
      expect(maplibrePitchToNavaraPitch(-10)).toBe(-100);

      // MapLibre pitch can exceed 90
      expect(maplibrePitchToNavaraPitch(100)).toBe(10);
    });
  });
});
