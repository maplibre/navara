import { describe, expect, it } from "vitest";

import { ColorMap } from "./ColorMap";

describe("ColorMap.flatten", () => {
  it("flattens the LUT into opaque RGBA", () => {
    const colorMap = new ColorMap("sequential", "test", [
      [0, 0.5, 1],
      [1, 0.25, 0],
    ]);
    expect(Array.from(colorMap.flatten())).toEqual([
      0, 0.5, 1, 1, 1, 0.25, 0, 1,
    ]);
  });
});
