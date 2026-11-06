import { type DataTexture, Matrix4, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  WATER_FLOW_PERIOD,
  WATER_SCALES,
  WATER_SCALE_FETCHES,
  WATER_TAP_COUNT,
  WaterState,
  meanSquareSlope,
  peakWavelength,
  windToCascades,
} from "./waterState";
import { WAVE_TEXTURE_SIZE } from "./waveTexture";

// The ENU frame comes from WASM, whose math the Rust unit tests cover. The
// phase bookkeeping only needs some orthonormal frame, so a fixed one stands
// in: east = +x, north = +y, up = +z.
vi.mock("@navaramap/three-api", async () => {
  const { Matrix4: M } = await import("three");
  return {
    eastNorthUpToFixedFrame: (origin: Vector3) => new M().setPosition(origin),
  };
});

const TOKYO = new Vector3(-3959786, 3352570, 3697475);

const createState = (
  loadWaveTexture = () => new Promise<Uint8Array>(() => {}),
) => new WaterState(1, loadWaveTexture);

describe("wind statistics", () => {
  it("follows Pierson–Moskowitz and Cox–Munk", () => {
    expect(peakWavelength(5)).toBeCloseTo(20.8, 1);
    expect(meanSquareSlope(5)).toBeCloseTo(0.0286, 4);
  });

  it("splits the wind's slopes between the cascades and the roughness", () => {
    const { cascades, fineMeanSquareSlope } = windToCascades(5);
    const resolved = cascades.reduce((sum, c) => sum + c.rmsSlope ** 2, 0);
    expect(resolved + fineMeanSquareSlope).toBeCloseTo(meanSquareSlope(5), 9);
    // Each cascade starts where the previous one ends.
    for (let i = 1; i < cascades.length; i++) {
      expect(cascades[i].tileLength).toBeLessThan(cascades[i - 1].tileLength);
    }
  });

  it("keeps the finest cascade small and the bands overlapping in strong wind", () => {
    const calm = windToCascades(5).cascades;
    expect(calm[1].tileLength / calm[0].tileLength).toBeCloseTo(1 / 6.3, 9);
    expect(calm[2].tileLength / calm[1].tileLength).toBeCloseTo(1 / 6.1, 9);
    for (const wind of [10, 20, 30]) {
      const { cascades } = windToCascades(wind);
      expect(cascades[2].tileLength).toBeLessThanOrEqual(3);
      // The texture spans 3 to 128 cycles per repeat, so neighbors overlap
      // while their length ratio stays below 128 / 3.
      for (let i = 1; i < cascades.length; i++) {
        const ratio = cascades[i - 1].tileLength / cascades[i].tileLength;
        expect(ratio).toBeLessThan(128 / 3);
      }
    }
  });

  it("limits the waves by the fetch up to the developed sea", () => {
    expect(peakWavelength(5, Infinity)).toBe(peakWavelength(5));
    // A long enough fetch reaches the developed sea.
    expect(peakWavelength(5, 1e7)).toBe(peakWavelength(5));
    // JONSWAP at 5 m/s over 2 km.
    expect(peakWavelength(5, 2000)).toBeCloseTo(2.69, 1);
    const lengths = WATER_SCALES.map(
      (scale) =>
        windToCascades(10, WATER_SCALE_FETCHES[scale]).cascades[0].tileLength,
    );
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]).toBeLessThan(lengths[i - 1]);
    }
  });

  it("keeps the finest cascade between 0.5 and 3 m at every scale", () => {
    for (const scale of WATER_SCALES) {
      for (const wind of [1, 5, 20]) {
        const { cascades } = windToCascades(wind, WATER_SCALE_FETCHES[scale]);
        const [base, middle, finest] = cascades.map((c) => c.tileLength);
        expect(finest).toBeLessThanOrEqual(Math.min(3, base));
        expect(finest).toBeGreaterThanOrEqual(Math.min(0.5, base));
        expect(middle).toBeLessThanOrEqual(base);
        expect(middle).toBeGreaterThanOrEqual(finest);
      }
    }
  });

  it("leaves calm water flat but finite", () => {
    const { cascades, fineMeanSquareSlope } = windToCascades(0);
    expect(cascades.every((c) => c.rmsSlope === 0)).toBe(true);
    expect(cascades.every((c) => Number.isFinite(c.tileLength))).toBe(true);
    expect(fineMeanSquareSlope).toBeCloseTo(0.003, 9);
  });
});

describe("WaterState", () => {
  const OCEAN = {
    strength: 5,
    direction: 0,
    scale: "ocean",
    flowSpeed: 0,
  } as const;

  it("keeps a ground point at the same texture coordinate as the camera moves", () => {
    const state = createState();
    const waves = WATER_SCALES.map((scale) =>
      state.createWaves({ ...OCEAN, scale }),
    );
    const view = new Matrix4();
    state.update(TOKYO, view, 0);

    // A point 40 m east and 25 m north of the camera.
    const before = waves.map((w) => w.tapUv(0, 40, 25));

    // 10 m east and 5 m south.
    const moved = TOKYO.clone().add(new Vector3(10, -5, 0));
    state.update(moved, view, 0);
    const after = waves.map((w) => w.tapUv(0, 30, 30));

    const wrapDelta = (a: number, b: number) => {
      const d = a - b;
      return d - Math.round(d);
    };
    WATER_SCALES.forEach((_, i) => {
      expect(wrapDelta(after[i][0], before[i][0])).toBeCloseTo(0, 5);
      expect(wrapDelta(after[i][1], before[i][1])).toBeCloseTo(0, 5);
    });
  });

  it("moves the waves toward their direction and wraps the phases", () => {
    const state = createState();
    const waves = state.createWaves({ ...OCEAN, strength: 8 });
    const view = new Matrix4();
    state.update(TOKYO, view, 0);
    const before = waves.tapUv(0, 0, 0);
    state.update(TOKYO, view, 10_000);
    const after = waves.tapUv(0, 0, 0);
    expect(after).not.toEqual(before);
    for (let tap = 0; tap < WATER_TAP_COUNT; tap++) {
      const [u, v] = waves.tapUv(tap, 0, 0);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("points the gust patch along the wave direction", () => {
    const state = createState();
    const gust = (direction: number) =>
      state.createWaves({ ...OCEAN, direction }).waves.gust;
    // x = east, y = north.
    expect(gust(0).x).toBeCloseTo(0, 9);
    expect(gust(0).y).toBeGreaterThan(0);
    expect(gust(90).x).toBeGreaterThan(0);
    expect(gust(90).y).toBeCloseTo(0, 9);
  });

  it("stores the unresolved slopes in the first cascade", () => {
    const { fineMeanSquareSlope } = windToCascades(8);
    const { cascades } = createState().createWaves({
      ...OCEAN,
      strength: 8,
    }).waves;
    expect(cascades[0].w).toBeCloseTo(fineMeanSquareSlope, 9);
  });

  it("shares one set between the surfaces with the same conditions", () => {
    const state = createState();
    const a = state.createWaves(OCEAN);
    const b = state.createWaves({ ...OCEAN });
    const other = state.createWaves({ ...OCEAN, direction: 90 });
    expect(b.waves).toBe(a.waves);
    expect(other.waves).not.toBe(a.waves);
  });

  it("gives each set its own phases", () => {
    const state = createState();
    const slow = state.createWaves({ ...OCEAN, strength: 2 });
    const fast = state.createWaves({ ...OCEAN, strength: 20 });
    state.advance(0, 0, 1);
    expect(fast.waves.taps[0].z).not.toBe(slow.waves.taps[0].z);
  });

  it("drops a set when the last surface lets go and keeps it until then", () => {
    const state = createState();
    const a = state.createWaves(OCEAN);
    const b = state.createWaves(OCEAN);
    const held = a.waves;
    a.dispose();
    // A second dispose must not take b's hold.
    a.dispose();
    expect(state.createWaves(OCEAN).waves).toBe(held);
    expect(b.waves).toBe(held);

    const fresh = createState();
    const only = fresh.createWaves(OCEAN);
    const dropped = only.waves;
    only.dispose();
    expect(fresh.createWaves(OCEAN).waves).not.toBe(dropped);
  });

  it("moves a surface between conditions", () => {
    const state = createState();
    const waves = state.createWaves(OCEAN);
    const before = waves.waves;
    waves.set(OCEAN);
    expect(waves.waves).toBe(before);
    waves.set({ ...OCEAN, scale: "small" });
    expect(waves.waves).not.toBe(before);
    expect(waves.cascades[0].tileLength).toBe(
      windToCascades(5, WATER_SCALE_FETCHES.small).cascades[0].tileLength,
    );
  });

  it("carries the pattern with the current", () => {
    const state = createState();
    const carried = state.createWaves({
      ...OCEAN,
      direction: 90,
      flowSpeed: 3,
    });
    const crossing = state.createWaves({ ...OCEAN, direction: 90 });
    state.advance(0, 0, 2);
    for (let tap = 0; tap < 6; tap++) {
      // What was at the origin has moved 6 m east, up to whole repeats.
      const [u, v] = carried.tapUv(tap, 6, 0);
      const [u0, v0] = crossing.tapUv(tap, 0, 0);
      expect(Math.abs(u - u0 - Math.round(u - u0))).toBeLessThan(1e-9);
      expect(Math.abs(v - v0 - Math.round(v - v0))).toBeLessThan(1e-9);
    }
    expect(carried.waves).not.toBe(crossing.waves);
  });

  it("stops advancing sets nobody holds", () => {
    const state = createState();
    const waves = state.createWaves(OCEAN);
    const held = waves.waves;
    const before = held.taps[0].z;
    waves.dispose();
    state.advance(0, 0, 1);
    expect(held.taps[0].z).toBe(before);
  });

  it("advances the flow cycle with time and wraps it", () => {
    const state = createState();
    const phase = state.uniforms.nvrWaterFlowPhase;
    state.advance(0, 0, WATER_FLOW_PERIOD / 4);
    expect(phase.value).toBeCloseTo(0.25, 10);
    state.advance(0, 0, WATER_FLOW_PERIOD * 1000.5);
    expect(phase.value).toBeCloseTo(0.75, 6);
    // Camera motion alone leaves the cycle where it was.
    state.advance(120, -45, 0);
    expect(phase.value).toBeCloseTo(0.75, 6);
  });

  it("holds flat water until the wave texture loads, then swaps it in", async () => {
    let resolve!: (data: Uint8Array) => void;
    const load = vi.fn(() => new Promise<Uint8Array>((r) => (resolve = r)));
    const state = createState(load);
    const texture = state.uniforms.nvrWaveTexture;
    const placeholder = texture.value;
    void state.uniforms;
    expect(load).toHaveBeenCalledTimes(1);
    expect((placeholder as DataTexture).image.width).toBe(1);

    resolve(new Uint8Array(WAVE_TEXTURE_SIZE * WAVE_TEXTURE_SIZE * 4));
    await Promise.resolve();

    expect(texture.value).not.toBe(placeholder);
    expect((texture.value as DataTexture).image.width).toBe(WAVE_TEXTURE_SIZE);
  });
});
