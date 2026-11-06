import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NearestMipmapNearestFilter,
  Texture,
} from "three";
import { describe, expect, it } from "vitest";

import type { TextureOptions } from "../../textures";

import { configureTexturizedTexture } from "./drapeResolver";

const options = (overrides: Partial<TextureOptions>): TextureOptions => ({
  maxAnisotropy: 4,
  minFilter: LinearFilter,
  magFilter: LinearFilter,
  useMipmaps: true,
  maxTextures: 8,
  ...overrides,
});

describe("configureTexturizedTexture", () => {
  it("skips mipmaps when the min filter never samples them", () => {
    for (const minFilter of [LinearFilter, NearestFilter]) {
      const tex = configureTexturizedTexture(
        new Texture(),
        options({ minFilter }),
      );
      expect(tex.generateMipmaps).toBe(false);
    }
  });

  it("generates mipmaps for a mipmap min filter", () => {
    for (const minFilter of [
      LinearMipmapLinearFilter,
      NearestMipmapNearestFilter,
    ]) {
      const tex = configureTexturizedTexture(
        new Texture(),
        options({ minFilter }),
      );
      expect(tex.generateMipmaps).toBe(true);
    }
  });

  it("honours useMipmaps: false with a mipmap min filter", () => {
    const tex = configureTexturizedTexture(
      new Texture(),
      options({ minFilter: LinearMipmapLinearFilter, useMipmaps: false }),
    );
    expect(tex.generateMipmaps).toBe(false);
  });

  it("applies the sampler settings", () => {
    const tex = configureTexturizedTexture(
      new Texture(),
      options({ magFilter: NearestFilter, maxAnisotropy: 8 }),
    );
    expect(tex.minFilter).toBe(LinearFilter);
    expect(tex.magFilter).toBe(NearestFilter);
    expect(tex.anisotropy).toBe(8);
  });
});
