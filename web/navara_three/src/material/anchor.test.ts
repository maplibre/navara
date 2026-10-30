import { describe, expect, it } from "vitest";

import type { Anchor } from "../type";

import {
  ANCHOR_ALIGN,
  anchorCode,
  isAnchor,
  spriteCenter,
  spriteCenterFromCode,
} from "./anchor";

const ANCHORS = Object.keys(ANCHOR_ALIGN) as Anchor[];

describe("isAnchor", () => {
  it("accepts exactly the anchor names", () => {
    for (const anchor of ANCHORS) expect(isAnchor(anchor)).toBe(true);
    for (const value of ["middle", "Top", "toString", "", undefined, 0]) {
      expect(isAnchor(value)).toBe(false);
    }
  });
});

describe("spriteCenter", () => {
  it("places the anchor on the quad, y up", () => {
    expect(spriteCenter("center")).toEqual([0, 0]);
    expect(spriteCenter("bottom")).toEqual([0, -0.5]);
    expect(spriteCenter("top-right")).toEqual([0.5, 0.5]);
    expect(spriteCenter("left")).toEqual([-0.5, 0]);
  });
});

describe("anchorCode", () => {
  it("packs each anchor into a distinct integer in 0..8", () => {
    const codes = ANCHORS.map(anchorCode);
    expect(new Set(codes).size).toBe(9);
    for (const code of codes) {
      expect(Number.isInteger(code)).toBe(true);
      expect(code).toBeGreaterThanOrEqual(0);
      expect(code).toBeLessThanOrEqual(8);
    }
  });

  it("decodes back to the anchor's sprite center", () => {
    for (const anchor of ANCHORS) {
      expect(spriteCenterFromCode(anchorCode(anchor))).toEqual(
        spriteCenter(anchor),
      );
    }
  });
});
