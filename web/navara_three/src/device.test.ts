import { describe, expect, it } from "vitest";

import { getDefaultMemoryCostHints } from "./device";

describe("getDefaultMemoryCostHints", () => {
  it("estimates a terrain tile's atlas as color + attr at 512² RGBA8", () => {
    for (const isMobile of [false, true]) {
      expect(getDefaultMemoryCostHints({ isMobile }).atlasTileBytes).toBe(
        2 * 512 * 512 * 4,
      );
    }
  });
});
