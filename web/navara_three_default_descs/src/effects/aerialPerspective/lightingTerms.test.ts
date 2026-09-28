import { AerialPerspectiveEffect } from "@takram/three-atmosphere";
import { PerspectiveCamera } from "three";
import { describe, expect, it, vi } from "vitest";

import { patchLightingTermsShader } from "./lightingTerms";

// The package index boots the worker pool, which needs a browser.
vi.mock("@navaramap/three", () =>
  vi.importActual("../../../../navara_three/src/utils/replacer"),
);

describe("patchLightingTermsShader", () => {
  it("finds its anchors in the shipped aerial perspective shader", () => {
    const effect = new AerialPerspectiveEffect(new PerspectiveCamera(), {
      octEncodedNormal: true,
    });
    const patched = patchLightingTermsShader(effect.getFragmentShader());

    const declaration = patched.indexOf("vec3 nvrGetSunSkyIrradiance(");
    const mainImage = patched.indexOf("void mainImage(");
    expect(declaration).toBeGreaterThan(-1);
    expect(declaration).toBeLessThan(mainImage);
    expect(patched).toContain(
      "radiance = nvrGetSunSkyIrradiance(uv, positionECEF, normalECEF, inputColor.rgb, sunTransmittance);",
    );
  });

  it("throws when an anchor is missing", () => {
    expect(() => patchLightingTermsShader("void main() {}")).toThrow();
  });
});
