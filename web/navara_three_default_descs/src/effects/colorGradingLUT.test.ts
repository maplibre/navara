import { Data3DTexture, PerspectiveCamera } from "three";
import { LUTCubeLoader } from "three/examples/jsm/loaders/LUTCubeLoader.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ColorGradingLUT } from "./colorGradingLUT";

// The package index boots the worker pool, which needs a browser.
vi.mock("@navaramap/three", async () => ({
  ...(await vi.importActual("../../../navara_three/src/effects/effect")),
  ...(await vi.importActual("../../../navara_three/src/utils/blendModes")),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ColorGradingLUT.dispose", () => {
  it("does not install a LUT that finishes loading after dispose", () => {
    let onLoad: (result: never) => void = () => {};
    vi.spyOn(LUTCubeLoader.prototype, "load").mockImplementation(
      (_url, load) => {
        onLoad = load as never;
        return undefined as never;
      },
    );
    const lut = new ColorGradingLUT(new PerspectiveCamera(), {
      url: "https://example.com/grade.cube",
    });
    const neutral = lut.rawEffect.lut;
    lut.dispose();
    const texture3D = new Data3DTexture(
      new Float32Array(2 * 2 * 2 * 4),
      2,
      2,
      2,
    );
    const dispose = vi.spyOn(texture3D, "dispose");

    onLoad({ size: 2, texture3D } as never);

    expect(lut.rawEffect.lut).toBe(neutral);
    expect(dispose).toHaveBeenCalled();
  });
});
