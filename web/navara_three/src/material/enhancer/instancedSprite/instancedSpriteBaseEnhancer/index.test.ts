import { DoubleSide, FrontSide, ShaderMaterial } from "three";
import type { Texture } from "three";
import { beforeEach, describe, expect, it } from "vitest";

import type { InstancedSpriteBaseProps } from "./types";

import { createInstancedSpriteBaseEnhancer } from "./index";

describe("instancedSpriteBaseEnhancer", () => {
  let enhancer: ReturnType<typeof createInstancedSpriteBaseEnhancer>;

  beforeEach(() => {
    enhancer = createInstancedSpriteBaseEnhancer(new ShaderMaterial());
  });

  describe("lifecycle", () => {
    it("transformShader() should throw if called before mount", () => {
      const freshEnhancer = createInstancedSpriteBaseEnhancer(
        new ShaderMaterial(),
      );

      const shader = {
        uniforms: {},
        vertexShader: "",
        fragmentShader: "",
        defines: {},
      } as any;

      expect(() => freshEnhancer.transformShader(shader)).toThrow(
        "mount() must be called before transformShader",
      );
    });

    it("states() should throw if called before mount", () => {
      const freshEnhancer = createInstancedSpriteBaseEnhancer(
        new ShaderMaterial(),
      );

      expect(() => freshEnhancer.states()).toThrow(
        "mount() must be called before states",
      );
    });

    it("mutates() should throw if called before mount", () => {
      const freshEnhancer = createInstancedSpriteBaseEnhancer(
        new ShaderMaterial(),
      );

      expect(() => freshEnhancer.mutates()).toThrow(
        "mount() must be called before mutates",
      );
    });

    it("update() should throw if called before mount", () => {
      const freshEnhancer = createInstancedSpriteBaseEnhancer(
        new ShaderMaterial(),
      );

      expect(() => freshEnhancer.update({})).toThrow(
        "mount() must be called before update",
      );
    });

    it("programCacheKey() should throw if called before mount", () => {
      const freshEnhancer = createInstancedSpriteBaseEnhancer(
        new ShaderMaterial(),
      );

      expect(() => freshEnhancer.programCacheKey()).toThrow(
        "mount() must be called before programCacheKey",
      );
    });

    it("should initialize state on mount", () => {
      const props: InstancedSpriteBaseProps = {
        scale: 50,
        center: [0.5, 0.5],
        pickable: true,
      };

      enhancer.mount(props);

      const state = enhancer.states();
      expect(state.scale).toBe(50);
      expect(state.center).toEqual([0.5, 0.5]);
      expect(state.pickable).toBe(true);
      expect(state.useRTE).toBe(false);
      expect(state.billboard).toBe(false);
    });

    it("should update state on update", () => {
      enhancer.mount({ scale: 50 });

      const stateBefore = enhancer.states();
      expect(stateBefore.scale).toBe(50);

      enhancer.update({ scale: 200 });

      const stateAfter = enhancer.states();
      expect(stateAfter.scale).toBe(200);
    });

    it("should allow transformShader after mount", () => {
      enhancer.mount({ scale: 50 });

      const shader = {
        uniforms: {} as any,
        vertexShader: "",
        fragmentShader: "",
        defines: {},
      } as any;

      // Should not throw
      expect(() => enhancer.transformShader(shader)).not.toThrow();

      // Should have assigned uniforms
      expect(shader.uniforms.uScale).toBeDefined();
      expect(shader.uniforms.uCenter).toBeDefined();
      expect(shader.uniforms.nvr_uPickable).toBeDefined();
    });

    it("should update material properties on mount", () => {
      const material = new ShaderMaterial();
      const e = createInstancedSpriteBaseEnhancer(material);
      e.mount({ transparent: false, depthTest: false });

      expect(material.transparent).toBe(false);
      expect(material.depthTest).toBe(false);
    });

    it("draws both sides unless backfaceCulling is on", () => {
      const material = new ShaderMaterial();
      const e = createInstancedSpriteBaseEnhancer(material);
      e.mount({});
      expect(material.side).toBe(DoubleSide);
      e.update({ backfaceCulling: true });
      expect(material.side).toBe(FrontSide);
    });

    it("should update material properties on update", () => {
      const material = new ShaderMaterial();
      const e = createInstancedSpriteBaseEnhancer(material);
      e.mount({});
      e.update({ transparent: false });

      expect(material.transparent).toBe(false);
    });

    it("should update texture and atlasSize together without replacing uTexture ref", () => {
      enhancer.mount({ billboard: true });

      const shader = {
        uniforms: {} as any,
        vertexShader: "",
        fragmentShader: "",
        defines: {},
      } as any;
      enhancer.transformShader(shader);

      const initialTextureUniform = shader.uniforms.uTexture;
      expect(initialTextureUniform).toBeDefined();

      const nextTexture = {
        image: {
          width: 1,
          height: 1,
          data: new Uint8Array([0, 0, 0, 0]),
        },
      } as unknown as Texture;

      enhancer.update({
        texture: { value: nextTexture },
        atlasSize: [512, 512],
      });

      expect(shader.uniforms.uTexture).toBe(initialTextureUniform);
      expect(shader.uniforms.uTexture.value).toBe(nextTexture);
      expect(shader.uniforms.uAtlasSize.value.x).toBe(512);
      expect(shader.uniforms.uAtlasSize.value.y).toBe(512);
      expect(enhancer.states().atlasSize).toEqual([512, 512]);
    });
  });

  describe("programCacheKey", () => {
    it("should return cache key based on shader-affecting state", () => {
      enhancer.mount({
        useRTE: true,
        billboard: true,
      });

      const cacheKey = enhancer.programCacheKey();
      const parsed = JSON.parse(cacheKey);

      expect(parsed).toEqual({
        useRTE: true,
        billboard: true,
        userDataDefines: undefined,
      });
    });

    it("should return different cache keys for different shader-affecting states", () => {
      enhancer.mount({ useRTE: false, billboard: false });
      const cacheKey1 = enhancer.programCacheKey();

      const enhancer2 = createInstancedSpriteBaseEnhancer(new ShaderMaterial());
      enhancer2.mount({ useRTE: true, billboard: false });
      const cacheKey2 = enhancer2.programCacheKey();

      expect(cacheKey1).not.toBe(cacheKey2);
    });

    it("should return same cache key for same shader-affecting states with different non-affecting states", () => {
      enhancer.mount({ useRTE: true, billboard: true, scale: 50 });
      const cacheKey1 = enhancer.programCacheKey();

      const enhancer2 = createInstancedSpriteBaseEnhancer(new ShaderMaterial());
      enhancer2.mount({ useRTE: true, billboard: true, scale: 200 });
      const cacheKey2 = enhancer2.programCacheKey();

      expect(cacheKey1).toBe(cacheKey2);
    });
  });
});
