import { MeshStandardMaterial } from "three";
import { beforeEach, describe, expect, it } from "vitest";

import { createModelBaseEnhancer } from "../modelBaseEnhancer";

import { createModelWaterEnhancer } from ".";

describe("modelWaterEnhancer", () => {
  let enhancer: ReturnType<typeof createModelWaterEnhancer>;

  beforeEach(() => {
    const baseEnhancer = createModelBaseEnhancer(new MeshStandardMaterial());
    enhancer = createModelWaterEnhancer(baseEnhancer);
  });

  describe("lifecycle", () => {
    it("states() should throw if called before mount", () => {
      const freshMaterial = new MeshStandardMaterial();
      const baseEnhancer = createModelBaseEnhancer(freshMaterial);
      const freshEnhancer = createModelWaterEnhancer(baseEnhancer);

      expect(() => freshEnhancer.states()).toThrow(
        "mount() must be called before states",
      );
    });
  });

  describe("programCacheKey", () => {
    it("should include water-specific state", () => {
      enhancer.mount({
        water: { water: true },
      });

      const cacheKey = enhancer.programCacheKey();

      expect(cacheKey).toContain('"useWater":true');
    });

    it("should return different cache keys when useWater differs", () => {
      enhancer.mount({ water: { water: false } });
      const cacheKey1 = enhancer.programCacheKey();

      const enhancer2 = createModelWaterEnhancer(
        createModelBaseEnhancer(new MeshStandardMaterial()),
      );
      enhancer2.mount({ water: { water: true } });
      const cacheKey2 = enhancer2.programCacheKey();

      expect(cacheKey1).not.toBe(cacheKey2);
    });

    it("should return same cache key for same shader-affecting states with different non-affecting states", () => {
      enhancer.mount({
        water: { water: true, waterSpeed: 1.0, shininess: 10 },
      });
      const cacheKey1 = enhancer.programCacheKey();

      const enhancer2 = createModelWaterEnhancer(
        createModelBaseEnhancer(new MeshStandardMaterial()),
      );
      enhancer2.mount({
        water: { water: true, waterSpeed: 5.0, shininess: 50 },
      });
      const cacheKey2 = enhancer2.programCacheKey();

      expect(cacheKey1).toBe(cacheKey2);
    });
  });
});
