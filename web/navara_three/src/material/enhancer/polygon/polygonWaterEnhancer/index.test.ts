import { MeshLambertMaterial } from "three";
import { beforeEach, describe, expect, it } from "vitest";

import { createPolygonBaseEnhancer } from "../polygonBaseEnhancer";

import { createPolygonWaterEnhancer } from ".";

describe("polygonWaterEnhancer", () => {
  let enhancer: ReturnType<typeof createPolygonWaterEnhancer>;

  beforeEach(() => {
    const baseEnhancer = createPolygonBaseEnhancer(new MeshLambertMaterial());
    enhancer = createPolygonWaterEnhancer(baseEnhancer);
  });

  describe("lifecycle", () => {
    it("states() should throw if called before mount", () => {
      const freshMaterial = new MeshLambertMaterial();
      const baseEnhancer = createPolygonBaseEnhancer(freshMaterial);
      const freshEnhancer = createPolygonWaterEnhancer(baseEnhancer);

      expect(() => freshEnhancer.states()).toThrow(
        "mount() must be called before states",
      );
    });
  });

  describe("programCacheKey", () => {
    it("should combine base cache key with water-specific state", () => {
      enhancer.mount({
        base: { isTexturized: true },
        water: { water: true },
      });

      const cacheKey = enhancer.programCacheKey();

      // Should contain both base and water cache keys
      expect(cacheKey).toContain('"isTexturized":true');
      expect(cacheKey).toContain('"useWater":true');
    });

    it("should return different cache keys when useWater differs", () => {
      enhancer.mount({ water: { water: false } });
      const cacheKey1 = enhancer.programCacheKey();

      const enhancer2 = createPolygonWaterEnhancer(
        createPolygonBaseEnhancer(new MeshLambertMaterial()),
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

      const enhancer2 = createPolygonWaterEnhancer(
        createPolygonBaseEnhancer(new MeshLambertMaterial()),
      );
      enhancer2.mount({
        water: { water: true, waterSpeed: 5.0, shininess: 50 },
      });
      const cacheKey2 = enhancer2.programCacheKey();

      expect(cacheKey1).toBe(cacheKey2);
    });
  });
});
