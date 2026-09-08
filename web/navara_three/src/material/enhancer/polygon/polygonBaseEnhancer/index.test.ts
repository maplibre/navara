import { MeshLambertMaterial } from "three";
import { beforeEach, describe, expect, it } from "vitest";

import { createPolygonBaseEnhancer } from ".";

describe("polygonBaseEnhancer", () => {
  let enhancer: ReturnType<typeof createPolygonBaseEnhancer>;

  beforeEach(() => {
    enhancer = createPolygonBaseEnhancer(new MeshLambertMaterial());
  });

  describe("lifecycle", () => {
    it("states() should throw if called before mount", () => {
      const freshEnhancer = createPolygonBaseEnhancer(
        new MeshLambertMaterial(),
      );
      expect(() => freshEnhancer.states()).toThrow(
        "mount() must be called before states",
      );
    });

    it("mutates() should throw if called before mount", () => {
      const freshEnhancer = createPolygonBaseEnhancer(
        new MeshLambertMaterial(),
      );
      expect(() => freshEnhancer.mutates()).toThrow(
        "mount() must be called before mutates",
      );
    });

    it("update() should throw if called before mount", () => {
      const freshEnhancer = createPolygonBaseEnhancer(
        new MeshLambertMaterial(),
      );
      expect(() => freshEnhancer.update({})).toThrow(
        "mount() must be called before update",
      );
    });
  });

  describe("programCacheKey", () => {
    it("should return cache key based on shader-affecting state", () => {
      enhancer.mount({
        isTexturized: true,
        clampToGround: false,
        useRTE: true,
      });

      const cacheKey = enhancer.programCacheKey();
      const parsed = JSON.parse(cacheKey);

      expect(parsed).toEqual({
        isTexturized: true,
        clampToGround: false,
        useRTE: true,
      });
    });

    it("should return different cache keys when useRTE differs", () => {
      enhancer.mount({ useRTE: false });
      const cacheKey1 = enhancer.programCacheKey();

      const enhancer2 = createPolygonBaseEnhancer(new MeshLambertMaterial());
      enhancer2.mount({ useRTE: true });
      const cacheKey2 = enhancer2.programCacheKey();

      expect(cacheKey1).not.toBe(cacheKey2);
    });

    it("should return same cache key for same shader-affecting states with different non-affecting states", () => {
      enhancer.mount({ addHeight: 10, opacity: 0.5 });
      const cacheKey1 = enhancer.programCacheKey();

      const enhancer2 = createPolygonBaseEnhancer(new MeshLambertMaterial());
      enhancer2.mount({ addHeight: 100, opacity: 1.0 });
      const cacheKey2 = enhancer2.programCacheKey();

      expect(cacheKey1).toBe(cacheKey2);
    });
  });
});
