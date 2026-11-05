import { describe, expect, it } from "vitest";

import { generateWaveSlopes, WAVE_TEXTURE_SIZE } from "./waveTexture";

const SIZE = WAVE_TEXTURE_SIZE;
const slopes = generateWaveSlopes();
const at = (x: number, y: number, channel: number) =>
  slopes[(((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)) * 4 + channel];

describe("generateWaveSlopes", () => {
  it.each([0, 1])(
    "gives realization %i zero mean and unit mean square slope",
    (realization) => {
      let sum = 0;
      let squares = 0;
      for (let i = 0; i < SIZE * SIZE; i++) {
        const sx = slopes[i * 4 + realization * 2];
        const sy = slopes[i * 4 + realization * 2 + 1];
        sum += sx + sy;
        squares += sx * sx + sy * sy;
      }
      expect(Math.abs(sum / (SIZE * SIZE))).toBeLessThan(0.01);
      expect(squares / (SIZE * SIZE)).toBeCloseTo(1, 6);
    },
  );

  it("repeats seamlessly", () => {
    // A step across the wrap is no larger than a typical step inside.
    let inner = 0;
    let wrap = 0;
    for (let y = 0; y < SIZE; y++) {
      inner += Math.abs(at(SIZE / 2, y, 0) - at(SIZE / 2 - 1, y, 0));
      wrap += Math.abs(at(0, y, 0) - at(-1, y, 0));
    }
    expect(wrap).toBeLessThan(inner * 2);
  });

  it("makes the two realizations uncorrelated", () => {
    let product = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      product += slopes[i * 4] * slopes[i * 4 + 2];
    }
    expect(Math.abs(product / (SIZE * SIZE))).toBeLessThan(0.1);
  });

  it("is deterministic", () => {
    const again = generateWaveSlopes();
    let mismatches = 0;
    for (let i = 0; i < slopes.length; i++) {
      if (again[i] !== slopes[i]) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});
