import { describe, expect, it, vi } from "vitest";

import {
  maplibrePitchToNavaraPitch,
  zoomToCameraHeight,
  MAPLIBRE_TILE_SIZE,
} from "./cameraHelpers";

// Mock ThreeView
const createMockView = (fov = 60, viewportHeight = 800) => {
  return {
    camera: { fov },
    renderer: { domElement: { height: viewportHeight } },
    zoomLevelToCameraHeight: vi.fn((zoom, lat, tileSizePx = 256, fovRad) => {
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
  describe("zoomToCameraHeight", () => {
    it("should use engine's zoomLevelToCameraHeight function", () => {
      const view = createMockView();
      zoomToCameraHeight(5, view, 0, MAPLIBRE_TILE_SIZE);
      expect(view.zoomLevelToCameraHeight).toHaveBeenCalledWith(
        5,
        0,
        MAPLIBRE_TILE_SIZE,
        undefined,
      );
    });

    it("should convert zoom 0 to a very large height", () => {
      const view = createMockView();
      const height = zoomToCameraHeight(0, view, 0, MAPLIBRE_TILE_SIZE);
      // At zoom 0, we should see the whole Earth
      // The actual value depends on FOV and viewport, can be quite high
      expect(height).toBeGreaterThan(50_000_000); // > 50,000 km
      expect(height).toBeLessThan(200_000_000); // < 200,000 km
    });

    it("should convert higher zoom levels to smaller heights", () => {
      const view = createMockView();
      const height0 = zoomToCameraHeight(0, view, 0, MAPLIBRE_TILE_SIZE);
      const height5 = zoomToCameraHeight(5, view, 0, MAPLIBRE_TILE_SIZE);
      const height10 = zoomToCameraHeight(10, view, 0, MAPLIBRE_TILE_SIZE);
      const height15 = zoomToCameraHeight(15, view, 0, MAPLIBRE_TILE_SIZE);

      // Height should decrease as zoom increases
      expect(height5).toBeLessThan(height0);
      expect(height10).toBeLessThan(height5);
      expect(height15).toBeLessThan(height10);
    });

    it("should account for latitude", () => {
      const view = createMockView();
      const heightEquator = zoomToCameraHeight(5, view, 0, MAPLIBRE_TILE_SIZE);
      const height45deg = zoomToCameraHeight(5, view, 45, MAPLIBRE_TILE_SIZE);

      // At higher latitudes, scale is different due to Web Mercator
      expect(heightEquator).not.toBe(height45deg);
    });

    it("should forward fovRad override and affect computed height", () => {
      const view = createMockView(60); // Default FOV = 60 degrees
      const zoom = 5;
      const lat = 0;
      const customFov = Math.PI / 4; // 45 degrees in radians (different from default 60)

      // Call with custom FOV
      const heightWithCustomFov = zoomToCameraHeight(
        zoom,
        view,
        lat,
        MAPLIBRE_TILE_SIZE,
        customFov,
      );

      // Verify the custom FOV was passed to the engine function
      expect(view.zoomLevelToCameraHeight).toHaveBeenCalledWith(
        zoom,
        lat,
        MAPLIBRE_TILE_SIZE,
        customFov,
      );

      // Call with default FOV (no override)
      const heightWithDefaultFov = zoomToCameraHeight(
        zoom,
        view,
        lat,
        MAPLIBRE_TILE_SIZE,
      );

      // Verify undefined was passed when no override
      expect(view.zoomLevelToCameraHeight).toHaveBeenCalledWith(
        zoom,
        lat,
        MAPLIBRE_TILE_SIZE,
        undefined,
      );

      // Height should differ when using different FOV values
      // Smaller FOV (45°) requires greater camera height for same zoom level
      expect(heightWithCustomFov).not.toBe(heightWithDefaultFov);
      expect(heightWithCustomFov).toBeGreaterThan(heightWithDefaultFov);
      expect(heightWithCustomFov).toBeGreaterThan(0);
      expect(heightWithDefaultFov).toBeGreaterThan(0);
    });

    it("should fallback to approximation if engine function unavailable", () => {
      const view = createMockView();
      view.zoomLevelToCameraHeight = vi.fn(() => undefined);

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const height = zoomToCameraHeight(5, view, 0, MAPLIBRE_TILE_SIZE);

      expect(consoleSpy).toHaveBeenCalledWith(
        "zoomLevelToCameraHeight not available, using approximation",
      );
      expect(height).toBeGreaterThan(0);

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
