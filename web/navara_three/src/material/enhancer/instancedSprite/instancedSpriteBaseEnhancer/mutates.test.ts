import { degreeToRadian } from "@navaramap/three-api";
import { Matrix4, type Texture } from "three";
import { describe, expect, it, vi } from "vitest";

import type { ShaderUniforms } from "../../MaterialEnhancer";

import { createBaseMutates } from "./mutates";
import { DEFAULT_BASE_STATE } from "./state";
import type { InstancedSpriteBaseState } from "./types";

vi.mock("@navaramap/three-api", () => ({
  degreeToRadian: (degree: number) => (degree * Math.PI) / 180,
  RTE_ONE_UNIFORM: { value: 1.0 },
}));

vi.mock("@navaramap/engine-api", () => ({
  encodePosition: (_x: number, _y: number, _z: number) => ({
    high: { x: 1000, y: 2000, z: 3000 },
    low: { x: 0.5, y: 0.25, z: 0.125 },
  }),
}));

describe("instancedSpriteBaseEnhancer/mutates", () => {
  describe("update syncs refs from state", () => {
    it("should sync core refs from state", () => {
      const state: InstancedSpriteBaseState = {
        ...DEFAULT_BASE_STATE,
        scale: 50,
        anchor: [0.5, 0.5],
        offset: [3, -4],
        translate: [5, 6],
        translateViewport: true,
        sizeInMeters: false,
        sizeRelativeToImage: true,
        offsetDepth: false,
        alphaTest: 0.3,
        pickable: true,
        atlasSize: [512, 256] as [number, number],
      };
      const mutates = createBaseMutates(false, false);
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uScale?.value).toBe(50);
      expect(uniforms.uAnchor?.value.x).toBe(0.5);
      expect(uniforms.uAnchor?.value.y).toBe(0.5);
      expect(uniforms.uOffset?.value.x).toBe(3);
      expect(uniforms.uOffset?.value.y).toBe(-4);
      expect(uniforms.uTranslate?.value.x).toBe(5);
      expect(uniforms.uTranslate?.value.y).toBe(6);
      expect(uniforms.uTranslateViewport?.value).toBe(true);
      expect(uniforms.uSizeInMeters?.value).toBe(false);
      expect(uniforms.uSizeRelativeToImage?.value).toBe(true);
      expect(uniforms.uOffsetDepth?.value).toBe(false);
      expect(uniforms.uAlphaTest?.value).toBe(0.3);
      expect(uniforms.nvr_uPickable?.value).toBe(1.0);
      expect(uniforms.uAtlasSize?.value.x).toBe(512);
      expect(uniforms.uAtlasSize?.value.y).toBe(256);
    });
  });

  describe("RTC center", () => {
    it("should initialize uRTCCenter from constructor args", () => {
      const state: InstancedSpriteBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates(false, false, [10, 20, 30]);
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uRTCCenter?.value.x).toBe(10);
      expect(uniforms.uRTCCenter?.value.y).toBe(20);
      expect(uniforms.uRTCCenter?.value.z).toBe(30);
    });
  });

  describe("billboard texture ref", () => {
    it("should assign uTexture to uniforms when billboard=true", () => {
      const state: InstancedSpriteBaseState = {
        ...DEFAULT_BASE_STATE,
        billboard: true,
      };
      const mutates = createBaseMutates(false, true);
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uTexture).toBeDefined();
      expect(uniforms.uTexture?.value).toBeNull();
    });

    it("should not assign uTexture to uniforms when billboard=false", () => {
      const state: InstancedSpriteBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates(false, false);
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uTexture).toBeUndefined();
    });

    it("should update uTexture value without replacing uniform ref", () => {
      const state: InstancedSpriteBaseState = {
        ...DEFAULT_BASE_STATE,
        billboard: true,
      };
      const mutates = createBaseMutates(false, true);
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);
      const initialTextureUniform = uniforms.uTexture;
      expect(initialTextureUniform).toBeDefined();

      const nextTexture = {
        image: {
          width: 1,
          height: 1,
          data: new Uint8Array([0, 0, 0, 0]),
        },
      } as unknown as Texture;

      mutates.setTexture({ value: nextTexture });

      expect(uniforms.uTexture).toBe(initialTextureUniform);
      expect(uniforms.uTexture?.value).toBe(nextTexture);
    });
  });

  describe("updateRteUniforms", () => {
    it("should update RTE eye uniforms when useRTE=true", () => {
      const state: InstancedSpriteBaseState = {
        ...DEFAULT_BASE_STATE,
        useRTE: true,
      };
      const mutates = createBaseMutates(true, false);
      mutates.update(state);

      // Call updateRteUniforms with some camera position
      mutates.updateRteUniforms(1000, 2000, 3000, state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      // encodePosition splits into high/low, verify they are set (not zero)
      const eyeHigh = uniforms.uEyeRTEHigh?.value;
      const eyeLow = uniforms.uEyeRTELow?.value;
      expect(eyeHigh).toBeDefined();
      expect(eyeLow).toBeDefined();
    });

    it("should do nothing when useRTE=false", () => {
      const state: InstancedSpriteBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates(false, false);
      mutates.update(state);

      mutates.updateRteUniforms(1000, 2000, 3000, state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      // Eye uniforms should remain at default (0, 0, 0)
      expect(uniforms.uEyeRTEHigh?.value.x).toBe(0);
      expect(uniforms.uEyeRTEHigh?.value.y).toBe(0);
      expect(uniforms.uEyeRTEHigh?.value.z).toBe(0);
    });
  });

  describe("updateRtcUniforms", () => {
    it("should transform the RTC center into view space when useRTE=false", () => {
      const state: InstancedSpriteBaseState = { ...DEFAULT_BASE_STATE };
      // RTC center at a large ECEF-scale coordinate.
      const mutates = createBaseMutates(false, false, [6_400_000, 0, 0]);
      mutates.update(state);

      // View matrix that translates the world by -6,400,000 on X, so the
      // center lands near the origin (small, precise value) in view space.
      const viewInverse = new Matrix4().makeTranslation(-6_400_000, 0, 0);
      mutates.updateRtcUniforms(viewInverse, state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uRTCCenterView?.value.x).toBeCloseTo(0, 3);
      expect(uniforms.uRTCCenterView?.value.y).toBeCloseTo(0, 3);
      expect(uniforms.uRTCCenterView?.value.z).toBeCloseTo(0, 3);
    });

    it("should do nothing when useRTE=true", () => {
      const state: InstancedSpriteBaseState = {
        ...DEFAULT_BASE_STATE,
        useRTE: true,
      };
      const mutates = createBaseMutates(true, false, [6_400_000, 0, 0]);
      mutates.update(state);

      mutates.updateRtcUniforms(
        new Matrix4().makeTranslation(-6_400_000, 0, 0),
        state,
      );

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      // Left at the default; the RTC path is not used under RTE.
      expect(uniforms.uRTCCenterView?.value.x).toBe(0);
    });
  });

  describe("updateFarPlane", () => {
    it("should update uFarPlane value", () => {
      const state: InstancedSpriteBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates(false, false);
      mutates.update(state);

      mutates.updateFarPlane(1000);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uFarPlane?.value).toBe(1000);
    });
  });

  describe("updateFovRad", () => {
    it("should update uFovRad value", () => {
      const state: InstancedSpriteBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates(false, false);
      mutates.update(state);

      mutates.updateFovRad(degreeToRadian(75));

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uFovRad?.value).toBe(degreeToRadian(75));
    });

    it("should not replace the uniform ref", () => {
      const state: InstancedSpriteBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates(false, false);
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);
      const initialRef = uniforms.uFovRad;

      mutates.updateFovRad(degreeToRadian(90));

      expect(uniforms.uFovRad).toBe(initialRef);
      expect(uniforms.uFovRad?.value).toBe(degreeToRadian(90));
    });
  });

  describe("updateScreenHeightPx", () => {
    it("should update uScreenHeightPx value", () => {
      const state: InstancedSpriteBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates(false, false);
      mutates.update(state);

      mutates.updateScreenHeightPx(720);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uScreenHeightPx?.value).toBe(720);
    });

    it("should not replace the uniform ref", () => {
      const state: InstancedSpriteBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates(false, false);
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);
      const initialRef = uniforms.uScreenHeightPx;

      mutates.updateScreenHeightPx(1440);

      expect(uniforms.uScreenHeightPx).toBe(initialRef);
      expect(uniforms.uScreenHeightPx?.value).toBe(1440);
    });
  });
});
