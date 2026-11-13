import { describe, expect, it } from "vitest";

import { RingBuffer } from "./ring";

describe("RingBuffer", () => {
  it("keeps the newest values and aggregates them", () => {
    const ring = new RingBuffer(3);
    for (const v of [5, 1, 4, 2]) ring.push(v);
    expect(ring.length).toBe(3);
    expect(ring.last).toBe(2);
    expect(ring.max()).toBe(4);
    expect(ring.average()).toBeCloseTo((1 + 4 + 2) / 3);
    expect(ring.percentile(0)).toBe(1);
    expect(ring.percentile(1)).toBe(4);
  });
});
