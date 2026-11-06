import { MeshLambertMaterial } from "three";
import { describe, expect, it } from "vitest";

import { applyWaterMaterialConfig } from "./material";
import { DEFAULT_WATER_STATE } from "./state";
import type { WaterSurfaceState } from "./types";

describe("water/material", () => {
  describe("applyWaterMaterialConfig", () => {
    it("should trigger material.needsUpdate when water flag changes", () => {
      const material = new MeshLambertMaterial();
      const state: WaterSurfaceState = {
        ...DEFAULT_WATER_STATE,
        useWater: true,
      };

      let needsUpdateCalled = false;
      Object.defineProperty(material, "needsUpdate", {
        set: (value: boolean) => {
          if (value) needsUpdateCalled = true;
        },
        configurable: true,
      });

      applyWaterMaterialConfig(material, state, false);
      expect(needsUpdateCalled).toBe(true);
    });

    it("should not trigger material.needsUpdate when water flag stays the same", () => {
      const material = new MeshLambertMaterial();
      const state: WaterSurfaceState = {
        ...DEFAULT_WATER_STATE,
        useWater: true,
      };

      let needsUpdateCalled = false;
      Object.defineProperty(material, "needsUpdate", {
        set: (value: boolean) => {
          if (value) needsUpdateCalled = true;
        },
        configurable: true,
      });

      applyWaterMaterialConfig(material, state, true);
      expect(needsUpdateCalled).toBe(false);
    });
  });
});
