import { describe, expect, it } from "vitest";

import { DEFAULT_WATER_STATE, updateWaterState } from "./state";
import type { WaterSurfaceState } from "./types";

/**
 * Helper to create expected water state by merging with defaults.
 */
const createExpectedState = (
  overrides: Partial<WaterSurfaceState> = {},
): WaterSurfaceState => ({
  ...DEFAULT_WATER_STATE,
  ...overrides,
});

describe("water/state", () => {
  describe("updateWaterState", () => {
    it("returns default state when given empty props", () => {
      const result = updateWaterState({}, DEFAULT_WATER_STATE);
      expect(result).toEqual(createExpectedState());
    });

    it("applies all props", () => {
      const result = updateWaterState(
        {
          water: true,
          waveExaggeration: 0.5,
          waterScale: "small",
          waveStrength: 2,
          waveDirection: 90,
          shininess: 30,
          specularStrength: 0.8,
          specular: true,
          ior: 1.5,
        },
        DEFAULT_WATER_STATE,
      );

      expect(result).toEqual(
        createExpectedState({
          useWater: true,
          waveExaggeration: 0.5,
          waterScale: "small",
          waveStrength: 2,
          waveDirection: 90,
          shininess: 30,
          specularStrength: 0.8,
          specular: true,
          ior: 1.5,
        }),
      );
    });

    it("falls back to currentState for missing props", () => {
      const currentState: WaterSurfaceState = {
        ...DEFAULT_WATER_STATE,
        useWater: true,
        waveExaggeration: 0.3,
        shininess: 25,
      };

      const result = updateWaterState({ specular: true }, currentState);

      expect(result.useWater).toBe(true);
      expect(result.waveExaggeration).toBe(0.3);
      expect(result.waterScale).toBe(currentState.waterScale);
      expect(result.shininess).toBe(25);
      expect(result.specular).toBe(true);
    });
  });
});
