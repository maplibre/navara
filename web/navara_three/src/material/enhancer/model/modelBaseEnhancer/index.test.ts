import { MeshStandardMaterial } from "three";
import { beforeEach, describe, expect, it } from "vitest";

import { createModelBaseEnhancer } from ".";

describe("modelBaseEnhancer", () => {
  let enhancer: ReturnType<typeof createModelBaseEnhancer>;

  beforeEach(() => {
    enhancer = createModelBaseEnhancer(new MeshStandardMaterial());
  });

  describe("lifecycle", () => {
    it("states() should throw if called before mount", () => {
      const freshEnhancer = createModelBaseEnhancer(new MeshStandardMaterial());
      expect(() => freshEnhancer.states()).toThrow(
        "mount() must be called before states",
      );
    });

    it("mutates() should throw if called before mount", () => {
      const freshEnhancer = createModelBaseEnhancer(new MeshStandardMaterial());
      expect(() => freshEnhancer.mutates()).toThrow(
        "mount() must be called before mutates",
      );
    });

    it("update() should throw if called before mount", () => {
      const freshEnhancer = createModelBaseEnhancer(new MeshStandardMaterial());
      expect(() => freshEnhancer.update({})).toThrow(
        "mount() must be called before update",
      );
    });
  });

  describe("programCacheKey", () => {
    it("should not vary with enhancer state (batch defines are covered by wrapProgramCacheKey)", () => {
      enhancer.mount({ pickable: true });
      const cacheKey1 = enhancer.programCacheKey();

      const enhancer2 = createModelBaseEnhancer(new MeshStandardMaterial());
      enhancer2.mount({ pickable: false, batchColorEnabled: true });
      const cacheKey2 = enhancer2.programCacheKey();

      expect(cacheKey1).toBe(cacheKey2);
    });
  });
});
