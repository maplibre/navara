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

  describe("transformShader", () => {
    it("removes ground defines once their condition is turned off", () => {
      enhancer.mount({ groundCulling: true, useGroundNormals: true });
      // A ShaderMaterial's compile reuses the same defines object.
      const defines: Record<string, unknown> = {};
      const shader = {
        uniforms: {},
        vertexShader: "",
        fragmentShader: "",
        defines,
      } as WebGLProgramParametersWithUniforms;

      enhancer.transformShader(shader);
      expect(defines.NVR_GROUND_POLYLINE).toBe(true);
      expect(defines.NVR_GROUND_POLYLINE_NORMALS).toBe(true);

      enhancer.update({ useGroundNormals: false });
      enhancer.transformShader(shader);
      expect(defines.NVR_GROUND_POLYLINE).toBe(true);
      expect(defines).not.toHaveProperty("NVR_GROUND_POLYLINE_NORMALS");

      enhancer.update({ groundCulling: false, useGroundNormals: true });
      enhancer.transformShader(shader);
      expect(defines).not.toHaveProperty("NVR_GROUND_POLYLINE");
      expect(defines).not.toHaveProperty("NVR_GROUND_POLYLINE_NORMALS");
    });

    it("defines the dash path only while the line has a dash pattern", () => {
      const atlas = { value: null };
      enhancer.mount({ dashRow: 3, lineDashAtlas: atlas });
      const defines: Record<string, unknown> = {};
      const shader = {
        uniforms: {},
        vertexShader: "",
        fragmentShader: "",
        defines,
      } as WebGLProgramParametersWithUniforms;

      enhancer.transformShader(shader);
      expect(defines.NVR_LINE_DASH).toBe(true);
      expect(shader.uniforms.uLineDashRow.value).toBe(3);
      // The atlas grows by swapping the ref's value, so the ref is bound.
      expect(shader.uniforms.tLineDashAtlas).toBe(atlas);

      enhancer.update({ dashRow: 0 });
      enhancer.transformShader(shader);
      expect(defines).not.toHaveProperty("NVR_LINE_DASH");
    });
  });

  describe("update", () => {
    it("recompiles when a dash pattern is set or cleared, not when it changes", () => {
      enhancer.mount({});
      const version = () => enhancer.material.version;

      let before = version();
      enhancer.update({ dashRow: 2 });
      expect(version()).toBeGreaterThan(before);

      before = version();
      enhancer.update({ dashRow: 5 });
      expect(version()).toBe(before);

      enhancer.update({ dashRow: 0 });
      expect(version()).toBeGreaterThan(before);
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
        groundCulling: false,
        useGroundNormals: false,
        useRTE: true,
        dashed: false,
      });
    });

    it("should change the cache key with a dash pattern, not with which one", () => {
      enhancer.mount({});
      const solid = enhancer.programCacheKey();

      enhancer.update({ dashRow: 2 });
      const dashed = enhancer.programCacheKey();
      expect(dashed).not.toBe(solid);

      enhancer.update({ dashRow: 5 });
      expect(enhancer.programCacheKey()).toBe(dashed);
    });

    it("should change the cache key with ground culling", () => {
      enhancer.mount({});
      const flat = enhancer.programCacheKey();

      enhancer.update({ groundCulling: true });
      const ground = enhancer.programCacheKey();
      expect(ground).not.toBe(flat);

      enhancer.update({ useGroundNormals: true });
      expect(enhancer.programCacheKey()).not.toBe(ground);
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
