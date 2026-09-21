import { type DataTexture, Color, Matrix4 } from "three";
import { describe, expect, it, vi } from "vitest";

import type { ShaderUniforms } from "../../MaterialEnhancer";

import { createBaseMutates } from "./mutates";
import { DEFAULT_BASE_STATE } from "./state";
import type { SdfTextBaseState } from "./types";

vi.mock("@navaramap/engine-api", () => ({
  encodePosition: (_x: number, _y: number, _z: number) => ({
    high: { x: 1000, y: 2000, z: 3000 },
    low: { x: 0.5, y: 0.25, z: 0.125 },
  }),
}));

describe("sdfTextBaseEnhancer/mutates", () => {
  describe("update syncs refs from state", () => {
    it("should sync core refs from state", () => {
      const state: SdfTextBaseState = {
        ...DEFAULT_BASE_STATE,
        center: [0.5, 0.5],
        flatFacing: true,
        rotateWithCamera: false,
        rotation: Math.PI / 2,
        sizeInMeters: true,
        offsetDepth: false,
        outlineWidth: 0.1,
        outlineColor: new Color(0x00ff00),
        outlineOpacity: 0.8,
        showBackground: true,
        backgroundColor: new Color(0x0000ff),
        backgroundOutlineColor: new Color(0xffff00),
        backgroundOutlineWidth: 0.2,
        pickable: true,
      };
      const mutates = createBaseMutates();
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uCenter?.value.x).toBe(0.5);
      expect(uniforms.uCenter?.value.y).toBe(0.5);
      expect(uniforms.uFlatFacing?.value).toBe(true);
      expect(uniforms.uRotateWithCamera?.value).toBe(false);
      expect(uniforms.uRotation?.value).toBeCloseTo(Math.PI / 2);
      expect(uniforms.uSizeInMeters?.value).toBe(true);
      expect(uniforms.uOffsetDepth?.value).toBe(false);
      expect(uniforms.uOutlineWidth?.value).toBe(0.1);
      expect(uniforms.uOutlineColor?.value.getHex()).toBe(0x00ff00);
      expect(uniforms.uOutlineOpacity?.value).toBe(0.8);
      expect(uniforms.uShowBackground?.value).toBe(true);
      expect(uniforms.uBackgroundColor?.value.getHex()).toBe(0x0000ff);
      expect(uniforms.uBackgroundOutlineColor?.value.getHex()).toBe(0xffff00);
      expect(uniforms.uBackgroundOutlineWidth?.value).toBe(0.2);
      expect(uniforms.nvr_uPickable?.value).toBe(1.0);
    });
  });

  describe("RTC center", () => {
    it("should initialize uRTCCenter from constructor args", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates([10, 20, 30]);
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uRTCCenter?.value.x).toBe(10);
      expect(uniforms.uRTCCenter?.value.y).toBe(20);
      expect(uniforms.uRTCCenter?.value.z).toBe(30);
    });
  });

  describe("per-label state is not uniform state", () => {
    // Anchors used to be uRTEPositionHIGH/LOW (RTE) or uRTCPosition (RTC) —
    // one material per label. Batched, every label's anchor is a texel in
    // uLabelData, so these uniforms must not come back: a single one would
    // silently place the whole batch at one point.
    it.each([true, false])(
      "exposes no position uniforms (useRTE=%s)",
      (useRTE) => {
        const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE, useRTE };
        const mutates = createBaseMutates();
        mutates.update(state);

        const uniforms: ShaderUniforms = {};
        mutates.updateUniforms(uniforms, state);

        expect(uniforms.uRTEPositionLOW).toBeUndefined();
        expect(uniforms.uRTEPositionHIGH).toBeUndefined();
        expect(uniforms.uRTCPosition).toBeUndefined();
        // The batch-wide RTC origin does stay a uniform.
        expect(uniforms.uRTCCenter).toBeDefined();
        expect(uniforms.uLabelData).toBeDefined();
      },
    );

    it("exposes no per-label style or batch-id uniforms", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates();
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      for (const name of [
        "uColor",
        "uOpacity",
        "uFontSize",
        "uAddHeight",
        "uTextWidth",
        "uTextHeight",
        "uBgYBounds",
        "uDeclutterHide",
        "nvr_uBatchId",
      ]) {
        expect(uniforms).not.toHaveProperty(name);
      }
      // Pick mode is still batch-wide.
      expect(uniforms.nvr_uPickable).toBeDefined();
    });
  });

  describe("atlas texture ref", () => {
    it("should update uAtlas value without replacing uniform ref", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates();
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);
      const initialAtlasUniform = uniforms.uAtlas;
      expect(initialAtlasUniform).toBeDefined();
      expect(initialAtlasUniform?.value).toBeNull();

      const nextTexture = {
        image: { width: 256, height: 256, data: new Uint8Array(256 * 256) },
      } as unknown as DataTexture;

      mutates.setAtlasTexture({ value: nextTexture });

      expect(uniforms.uAtlas).toBe(initialAtlasUniform);
      expect(uniforms.uAtlas?.value).toBe(nextTexture);
    });
  });

  describe("updateAtlasSizes", () => {
    it("should sync uSdfAtlasSize and uColorAtlasSize from bound texture images", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates();
      mutates.update(state);

      const sdfTex = {
        image: { width: 1024, height: 2048, data: new Uint8Array(1) },
      } as unknown as DataTexture;
      const colorTex = {
        image: { width: 4096, height: 4096, data: new Uint8Array(1) },
      } as unknown as DataTexture;

      mutates.setAtlasTexture({ value: sdfTex });
      mutates.setColorAtlasTexture({ value: colorTex });
      mutates.updateAtlasSizes();

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uSdfAtlasSize?.value.x).toBe(1024);
      expect(uniforms.uSdfAtlasSize?.value.y).toBe(2048);
      expect(uniforms.uColorAtlasSize?.value.x).toBe(4096);
      expect(uniforms.uColorAtlasSize?.value.y).toBe(4096);
    });

    it("should pick up new dimensions after the atlas grows", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates();
      mutates.update(state);

      const sdfTex = {
        image: { width: 2048, height: 2048, data: new Uint8Array(1) },
      } as unknown as DataTexture;
      mutates.setAtlasTexture({ value: sdfTex });
      mutates.updateAtlasSizes();

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);
      expect(uniforms.uSdfAtlasSize?.value.x).toBe(2048);
      expect(uniforms.uSdfAtlasSize?.value.y).toBe(2048);

      // Simulate the SDFAtlas growing — the image dims on the same texture
      // change, and updateAtlasSizes() must propagate them to the uniform.
      sdfTex.image = {
        width: 4096,
        height: 4096,
        data: new Uint8Array(1),
      } as DataTexture["image"];
      mutates.updateAtlasSizes();

      expect(uniforms.uSdfAtlasSize?.value.x).toBe(4096);
      expect(uniforms.uSdfAtlasSize?.value.y).toBe(4096);
    });

    it("should leave atlas size uniforms unchanged when textures are null", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates();
      mutates.update(state);

      // Both uAtlas and uColorAtlas default to null.
      mutates.updateAtlasSizes();

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      // Defaults set in createBaseMutates: (1, 1) to avoid divide-by-zero.
      expect(uniforms.uSdfAtlasSize?.value.x).toBe(1);
      expect(uniforms.uSdfAtlasSize?.value.y).toBe(1);
      expect(uniforms.uColorAtlasSize?.value.x).toBe(1);
      expect(uniforms.uColorAtlasSize?.value.y).toBe(1);
    });

    it("should leave atlas size uniforms unchanged when image has zero dimensions", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates();
      mutates.update(state);

      const sdfTex = {
        image: { width: 0, height: 0, data: new Uint8Array(0) },
      } as unknown as DataTexture;
      mutates.setAtlasTexture({ value: sdfTex });
      mutates.updateAtlasSizes();

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uSdfAtlasSize?.value.x).toBe(1);
      expect(uniforms.uSdfAtlasSize?.value.y).toBe(1);
    });
  });

  describe("updatePerFrame", () => {
    it("should update camera uniforms", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates();
      mutates.update(state);

      mutates.updatePerFrame(1.5, 1080, 10000, 0, 0, 0, new Matrix4(), state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uFovRad?.value).toBe(1.5);
      expect(uniforms.uScreenHeightPx?.value).toBe(1080);
      expect(uniforms.uFarPlane?.value).toBe(10000);
    });

    it("should update RTE eye uniforms when useRTE=true", () => {
      const state: SdfTextBaseState = {
        ...DEFAULT_BASE_STATE,
        useRTE: true,
      };
      const mutates = createBaseMutates();
      mutates.update(state);

      mutates.updatePerFrame(
        1.0,
        1080,
        1000,
        100,
        200,
        300,
        new Matrix4(),
        state,
      );

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      const eyeHigh = uniforms.uEyeRTEHigh?.value;
      const eyeLow = uniforms.uEyeRTELow?.value;
      expect(eyeHigh).toBeDefined();
      expect(eyeLow).toBeDefined();
      // Values come from the mocked encodePosition
      expect(eyeHigh?.x).toBe(1000);
      expect(eyeLow?.x).toBe(0.5);
    });

    it("should not update RTE eye uniforms when useRTE=false", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates();
      mutates.update(state);

      mutates.updatePerFrame(
        1.0,
        1080,
        1000,
        100,
        200,
        300,
        new Matrix4(),
        state,
      );

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uEyeRTEHigh?.value.x).toBe(0);
      expect(uniforms.uEyeRTEHigh?.value.y).toBe(0);
      expect(uniforms.uEyeRTEHigh?.value.z).toBe(0);
    });

    it("should transform the RTC center into view space when useRTE=false", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates([6_400_000, 0, 0]);
      mutates.update(state);

      // View matrix cancels the center's large X so it lands near the origin.
      const viewInverse = new Matrix4().makeTranslation(-6_400_000, 0, 0);
      mutates.updatePerFrame(1.0, 1080, 1000, 0, 0, 0, viewInverse, state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uRTCCenterView?.value.x).toBeCloseTo(0, 3);
      expect(uniforms.uRTCCenterView?.value.y).toBeCloseTo(0, 3);
      expect(uniforms.uRTCCenterView?.value.z).toBeCloseTo(0, 3);
    });
  });

  describe("setLabelDataTexture", () => {
    it("should bind the texture and its dimensions", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates();
      mutates.update(state);

      const tex = { isDataTexture: true } as unknown as DataTexture;
      mutates.setLabelDataTexture(tex, 64, 5);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uLabelData?.value).toBe(tex);
      expect(uniforms.uLabelTexSize?.value.x).toBe(64);
      expect(uniforms.uLabelTexSize?.value.y).toBe(5);
    });

    // The shader does `i % size.x` and `i / size.x`; a zero would divide by
    // zero before the mesh has bound anything.
    it("should never expose a zero dimension", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates();
      mutates.update(state);

      mutates.setLabelDataTexture(null, 0, 0);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uLabelTexSize?.value.x).toBe(1);
      expect(uniforms.uLabelTexSize?.value.y).toBe(1);
    });
  });

  describe("setRtcCenter", () => {
    it("should update uRTCCenter after a transform change", () => {
      const state: SdfTextBaseState = { ...DEFAULT_BASE_STATE };
      const mutates = createBaseMutates([1, 2, 3]);
      mutates.update(state);

      mutates.setRtcCenter([100, 200, 300]);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uRTCCenter?.value.x).toBe(100);
      expect(uniforms.uRTCCenter?.value.y).toBe(200);
      expect(uniforms.uRTCCenter?.value.z).toBe(300);
    });
  });
});
