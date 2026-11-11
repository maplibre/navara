import { describe, expect, it, vi } from "vitest";

import { WaterState } from "../../../water/waterState";
import type { ShaderUniforms } from "../MaterialEnhancer";

import { createWaterMutates } from "./mutates";
import { DEFAULT_WATER_STATE } from "./state";

const WATER = { ...DEFAULT_WATER_STATE, useWater: true };

const createWaterState = () =>
  new WaterState(1, () => new Promise<Uint8Array>(() => {}));

describe("water/mutates", () => {
  describe("updateUniforms", () => {
    it("assigns the shared uniforms and its waves to a water shader", () => {
      const waterState = createWaterState();
      const mutates = createWaterMutates();
      mutates.setWaterState(() => waterState);
      mutates.update(WATER);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, WATER);

      expect(uniforms.nvrWaveTexture).toBe(waterState.uniforms.nvrWaveTexture);
      expect(uniforms.nvrWaterWaves?.value).toEqual([mutates.waves()]);
    });

    it("sets the wave strength", () => {
      const mutates = createWaterMutates();
      const state = { ...DEFAULT_WATER_STATE, waveExaggeration: 0.5 };
      mutates.update(state);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, state);

      expect(uniforms.uWaveExaggeration?.value).toBe(0.5);
    });

    it("never touches the water state for a non-water shader", () => {
      const mutates = createWaterMutates();
      const getWaterState = vi.fn(createWaterState);
      mutates.setWaterState(getWaterState);
      mutates.update(DEFAULT_WATER_STATE);

      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, DEFAULT_WATER_STATE);

      expect(getWaterState).not.toHaveBeenCalled();
      expect(uniforms.nvrWaveTexture).toBeUndefined();
      expect(mutates.waves()).toBeUndefined();
    });
  });

  describe("waves", () => {
    it("swaps the waves behind the same uniform ref when the conditions change", () => {
      const waterState = createWaterState();
      const mutates = createWaterMutates();
      mutates.setWaterState(() => waterState);
      mutates.update(WATER);
      const uniforms: ShaderUniforms = {};
      mutates.updateUniforms(uniforms, WATER);
      const ref = uniforms.nvrWaterWaves;
      const before = mutates.waves();

      mutates.update({ ...WATER, waveStrength: 12 });

      expect(uniforms.nvrWaterWaves).toBe(ref);
      expect(mutates.waves()).not.toBe(before);
      expect(ref?.value).toEqual([mutates.waves()]);
    });

    it("lets go of the waves when the surface stops being water", () => {
      const waterState = createWaterState();
      const mutates = createWaterMutates();
      mutates.setWaterState(() => waterState);
      mutates.update(WATER);

      mutates.update(DEFAULT_WATER_STATE);

      expect(mutates.waves()).toBeUndefined();
    });
  });
});
