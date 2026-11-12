import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NearestMipmapNearestFilter,
  Texture,
} from "three";
import { describe, expect, it } from "vitest";

import { configureTexturizedTexture } from "./drapeResolver";

describe("configureTexturizedTexture", () => {
  it.each([
    [LinearFilter, true, false],
    [NearestFilter, true, false],
    [LinearMipmapLinearFilter, true, true],
    [NearestMipmapNearestFilter, true, true],
    [LinearMipmapLinearFilter, false, false],
  ])(
    "minFilter %i, useMipmaps %s → generateMipmaps %s",
    (minFilter, useMipmaps, expected) => {
      const tex = configureTexturizedTexture(new Texture(), {
        maxAnisotropy: 4,
        minFilter,
        magFilter: LinearFilter,
        useMipmaps,
        maxTextures: 8,
      });
      expect(tex.generateMipmaps).toBe(expected);
    },
  );
});
