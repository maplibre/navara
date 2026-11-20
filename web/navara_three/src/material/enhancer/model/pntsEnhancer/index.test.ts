import { PointsMaterial } from "three";
import { beforeEach, describe, expect, it } from "vitest";

import { createPntsEnhancer } from ".";

describe("pntsEnhancer", () => {
  let enhancer: ReturnType<typeof createPntsEnhancer>;

  beforeEach(() => {
    enhancer = createPntsEnhancer(new PointsMaterial());
  });

  describe("lifecycle", () => {
    it("states() should throw if called before mount", () => {
      const freshEnhancer = createPntsEnhancer(new PointsMaterial());
      expect(() => freshEnhancer.states()).toThrow(
        "mount() must be called before states",
      );
    });

    it("mutates() should throw if called before mount", () => {
      const freshEnhancer = createPntsEnhancer(new PointsMaterial());
      expect(() => freshEnhancer.mutates()).toThrow(
        "mount() must be called before mutates",
      );
    });

    it("update() should throw if called before mount", () => {
      const freshEnhancer = createPntsEnhancer(new PointsMaterial());
      expect(() => freshEnhancer.update({})).toThrow(
        "mount() must be called before update",
      );
    });
  });

  describe("mount", () => {
    it("should initialize state with provided props", () => {
      enhancer.mount({
        height: 100,
        geodeticNormal: { x: 0.1, y: 0.2, z: 0.3 },
      });

      const state = enhancer.states();
      expect(state.height).toBe(100);
      expect(state.geodeticNormal).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
    });

    it("should use defaults for missing props", () => {
      enhancer.mount({});

      const state = enhancer.states();
      expect(state.height).toBe(0);
      expect(state.geodeticNormal).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  describe("update", () => {
    it("should update state with new props", () => {
      enhancer.mount({ height: 50 });
      enhancer.update({ height: 200 });

      const state = enhancer.states();
      expect(state.height).toBe(200);
    });

    it("should preserve state for missing props", () => {
      enhancer.mount({
        height: 100,
        geodeticNormal: { x: 1, y: 0, z: 0 },
      });
      enhancer.update({ height: 200 });

      const state = enhancer.states();
      expect(state.height).toBe(200);
      expect(state.geodeticNormal).toEqual({ x: 1, y: 0, z: 0 });
    });
  });

  describe("programCacheKey", () => {
    it("should differ by srgbVertexColor only", () => {
      enhancer.mount({ height: 100, srgbVertexColor: true });
      const key1 = enhancer.programCacheKey();

      const enhancer2 = createPntsEnhancer(new PointsMaterial());
      enhancer2.mount({ height: 200, srgbVertexColor: true });
      expect(enhancer2.programCacheKey()).toBe(key1);

      const enhancer3 = createPntsEnhancer(new PointsMaterial());
      enhancer3.mount({ height: 100, srgbVertexColor: false });
      expect(enhancer3.programCacheKey()).not.toBe(key1);
    });
  });
});
