import { describe, expect, it } from "vitest";

import { isClampedToGround, toGeometryMaterial } from "./featureStyle";

describe("isClampedToGround", () => {
  it("treats an unset key as clamped", () => {
    expect(isClampedToGround({})).toBe(true);
  });

  it("honours an explicit value", () => {
    expect(isClampedToGround({ clampToGround: false })).toBe(false);
    expect(isClampedToGround({ clampToGround: true })).toBe(true);
  });
});

describe("toGeometryMaterial", () => {
  it("drops omitted keys, resolves colours and clampToGround", () => {
    const style = {
      color: { toHex: () => 0xff0000 },
      height: 3,
      positions: [],
      clampToGround: undefined,
    };
    expect(toGeometryMaterial(style, ["positions"])).toEqual({
      color: 0xff0000,
      height: 3,
      clampToGround: true,
    });
  });
});
