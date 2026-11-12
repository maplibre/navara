import { describe, expect, it } from "vitest";

import { keyframes } from "./keyframes";

const tolerance = { maxLevelError: 0.1, maxErrorShare: 0, shoreDistance: 25 };

describe("keyframes", () => {
  it("keeps the frames around one off the straight line", () => {
    const levels = Float32Array.from([0, 1, 2, 3.5, 4, 5, 6]);
    const distances = new Float32Array(7).fill(-10);
    const times = [0, 1, 2, 3, 4, 5, 6];
    expect(keyframes(times, levels, distances, 1, tolerance)).toEqual([
      0, 2, 3, 4, 6,
    ]);
  });

  it("keeps the widest frame, though its extra cell is near the shore", () => {
    // Two cells over five frames; the second is wet only in the middle one.
    const levels = Float32Array.from([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    const distances = Float32Array.from([
      -10, 10, -10, 10, -10, -1, -10, 10, -10, 10,
    ]);
    const times = [0, 1, 2, 3, 4];
    expect(keyframes(times, levels, distances, 2, tolerance)).toEqual([
      0, 2, 4,
    ]);
  });
});
