import { describe, expect, it } from "vitest";

import { pack, planPacking, type PackingPlan } from "./pack";

/** The value stored as `code` by `plan`; NaN for the fill value. */
const unpack = (code: number, plan: PackingPlan) =>
  code === plan.fill ? NaN : code * plan.scale + plan.offset;

describe("planPacking", () => {
  it("picks the smallest integer type for the range at the precision", () => {
    expect(planPacking(0, 2.5, 0.01)).toEqual({
      dtype: "uint8",
      scale: 0.01,
      offset: 0,
      fill: 255,
    });
    expect(planPacking(10, 20, 0.001)).toMatchObject({
      dtype: "uint16",
      offset: 10,
      fill: 65535,
    });
    expect(planPacking(0, 1000, 0.001).dtype).toBe("float32");
  });

  it("stores as float32 without a precision or a range", () => {
    expect(planPacking(0, 1).dtype).toBe("float32");
    expect(planPacking(Infinity, -Infinity, 0.1).dtype).toBe("float32");
  });
});

describe("pack", () => {
  it("round-trips through the fill value", () => {
    const plan = planPacking(1, 3, 0.5);
    const packed = pack([1, 2.5, NaN, 3], plan);
    expect(packed).toBeInstanceOf(Uint8Array);
    expect([...packed]).toEqual([0, 3, 255, 4]);
    expect([...packed].map((c) => unpack(c, plan))).toEqual([1, 2.5, NaN, 3]);
  });

  it("clamps int16 inside its range", () => {
    const plan = {
      dtype: "int16",
      scale: 0.5,
      offset: 0,
      fill: -32768,
    } as const;
    expect([...pack([-1e10, 1e10, -1.25], plan)]).toEqual([-32767, 32767, -2]);
  });
});
