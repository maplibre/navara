import { describe, expect, it } from "vitest";

import { parseDuration, thinTimes } from "./time";

describe("parseDuration", () => {
  it("reads seconds, minutes and hours", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("30m")).toBe(1800);
    expect(parseDuration("1.5h")).toBe(5400);
    expect(() => parseDuration("30 min")).toThrow();
  });
});

describe("thinTimes", () => {
  it("keeps steps at least the interval apart across changing steps", () => {
    // 10 min steps, then 60 min ones.
    const times = [0, 10, 20, 30, 40, 50, 60, 120, 180].map((m) => m * 60);
    expect(thinTimes(times, 1800)).toEqual([0, 3, 6, 7, 8]);
  });
});
