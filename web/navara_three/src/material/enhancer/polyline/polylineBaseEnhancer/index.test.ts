import { ShaderMaterial, type WebGLProgramParametersWithUniforms } from "three";
import { beforeEach, describe, expect, it } from "vitest";

import type { PolylineBaseProps } from "./types";

import { createPolylineBaseEnhancer } from "./index";

describe("polylineBaseEnhancer", () => {
  let enhancer: ReturnType<typeof createPolylineBaseEnhancer>;

  beforeEach(() => {
    enhancer = createPolylineBaseEnhancer(new ShaderMaterial());
  });

  describe("lifecycle", () => {
    it("transformShader() should throw if called before mount", () => {
      const freshEnhancer = createPolylineBaseEnhancer(new ShaderMaterial());

      const shader = {
        uniforms: {},
        vertexShader: "",
        fragmentShader: "",
        defines: {},
      } as WebGLProgramParametersWithUniforms;

      expect(() => freshEnhancer.transformShader(shader)).toThrow(
        "mount() must be called before transformShader",
      );
    });

    it("states() should throw if called before mount", () => {
      const freshEnhancer = createPolylineBaseEnhancer(new ShaderMaterial());

      expect(() => freshEnhancer.states()).toThrow(
        "mount() must be called before states",
      );
    });

    it("mutates() should throw if called before mount", () => {
      const freshEnhancer = createPolylineBaseEnhancer(new ShaderMaterial());

      expect(() => freshEnhancer.mutates()).toThrow(
        "mount() must be called before mutates",
      );
    });

    it("update() should throw if called before mount", () => {
      const freshEnhancer = createPolylineBaseEnhancer(new ShaderMaterial());

      expect(() => freshEnhancer.update({})).toThrow(
        "mount() must be called before update",
      );
    });

    it("programCacheKey() should throw if called before mount", () => {
      const freshEnhancer = createPolylineBaseEnhancer(new ShaderMaterial());

      expect(() => freshEnhancer.programCacheKey()).toThrow(
        "mount() must be called before programCacheKey",
      );
    });

    it("should initialize state on mount", () => {
      const props: PolylineBaseProps = {
        color: 0xff0000,
        width: 2,
        pickable: true,
      };

      enhancer.mount(props);

      const state = enhancer.states();
      expect(state.color).toBe(0xff0000);
      expect(state.width).toBe(2);
      expect(state.pickable).toBe(true);
      expect(state.useRTE).toBe(false);
    });

    it("should update state on update", () => {
      enhancer.mount({ width: 2 });

      const stateBefore = enhancer.states();
      expect(stateBefore.width).toBe(2);

      enhancer.update({ width: 5 });

      const stateAfter = enhancer.states();
      expect(stateAfter.width).toBe(5);
    });

    it("should allow transformShader after mount", () => {
      enhancer.mount({ width: 2 });

      const shader = {
        uniforms: {},
        vertexShader: "",
        fragmentShader: "",
        defines: {},
      } as WebGLProgramParametersWithUniforms;

      // Should not throw
      expect(() => enhancer.transformShader(shader)).not.toThrow();

      // Should have assigned uniforms
      expect(shader.uniforms.minMaxHeightAndWidth).toBeDefined();
      expect(shader.uniforms.color).toBeDefined();
      expect(shader.uniforms.nvr_uPickable).toBeDefined();
    });
  });

  describe("programCacheKey", () => {
    it("should return cache key based on shader-affecting state", () => {
      enhancer.mount({
        isTexturized: true,
        useRTE: true,
      });

      const cacheKey = enhancer.programCacheKey();
      const parsed = JSON.parse(cacheKey);

      expect(parsed).toEqual({
        isTexturized: true,
        useRTE: true,
      });
    });

    it("should return different cache keys for different userData defines", () => {
      enhancer.mount({});
      const cacheKey1 = enhancer.programCacheKey();

      const material2 = new ShaderMaterial();
      material2.userData.defines = { USE_BATCH_HEIGHT: true };
      const enhancer2 = createPolylineBaseEnhancer(material2);
      enhancer2.mount({});
      const cacheKey2 = enhancer2.programCacheKey();

      expect(cacheKey1).not.toBe(cacheKey2);
    });

    it("should return same cache key for same shader-affecting states with different non-affecting states", () => {
      enhancer.mount({ width: 2, color: 0xff0000 });
      const cacheKey1 = enhancer.programCacheKey();

      const enhancer2 = createPolylineBaseEnhancer(new ShaderMaterial());
      enhancer2.mount({ width: 10, color: 0x00ff00 });
      const cacheKey2 = enhancer2.programCacheKey();

      expect(cacheKey1).toBe(cacheKey2);
    });
  });
});
