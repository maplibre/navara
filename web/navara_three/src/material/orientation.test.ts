import { describe, expect, it } from "vitest";

import { resolveOrientation } from "./orientation";

describe("resolveOrientation", () => {
  it("resolves MapLibre's auto from placement when both are unset", () => {
    expect(resolveOrientation(undefined, undefined, undefined)).toEqual({
      flatFacing: false,
      rotateWithCamera: true,
    });
    expect(resolveOrientation(undefined, undefined, "point")).toEqual({
      flatFacing: false,
      rotateWithCamera: true,
    });
    for (const placement of ["line", "line-center"]) {
      expect(resolveOrientation(undefined, undefined, placement)).toEqual({
        flatFacing: true,
        rotateWithCamera: false,
      });
    }
  });

  it("derives an unset facing from rotateWithCamera, not from placement", () => {
    expect(resolveOrientation(undefined, false, "point")).toEqual({
      flatFacing: true,
      rotateWithCamera: false,
    });
    expect(resolveOrientation(undefined, true, "line")).toEqual({
      flatFacing: false,
      rotateWithCamera: true,
    });
  });

  it("keeps explicit values whatever the placement", () => {
    for (const placement of [undefined, "point", "line", "line-center"]) {
      expect(resolveOrientation("upright", false, placement)).toEqual({
        flatFacing: false,
        rotateWithCamera: false,
      });
      expect(resolveOrientation("flat", true, placement)).toEqual({
        flatFacing: true,
        rotateWithCamera: true,
      });
    }
  });
});
