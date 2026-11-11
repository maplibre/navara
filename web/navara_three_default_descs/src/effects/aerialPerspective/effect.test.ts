import { Observed } from "@navaramap/core";
import { PerspectiveCamera } from "three";
import { describe, expect, it, vi } from "vitest";

import { AerialPerspective } from "./effect";

// The package index boots the worker pool, which needs a browser.
vi.mock("@navaramap/three", async () => ({
  ...(await vi.importActual("../../../../navara_three/src/effects/effect")),
  ...(await vi.importActual(
    "../../../../navara_three/src/effects/CustomEffectPass",
  )),
  ...(await vi.importActual("../../../../navara_three/src/utils/replacer")),
}));

const fakeAtmosphere = () => ({
  overlay: new Observed(null),
  shadow: new Observed(null),
  shadowLength: new Observed(null),
  enableShadows: new Observed(false),
  onTexturesReady: vi.fn(() => vi.fn()),
});

describe("AerialPerspective.dispose", () => {
  it("stops listening to the atmosphere", () => {
    const atmosphere = fakeAtmosphere();
    const ap = new AerialPerspective(
      atmosphere as never,
      new PerspectiveCamera(),
      null,
      { irradiance: true },
    );
    const cancels = atmosphere.onTexturesReady.mock.results.map((r) => r.value);

    ap.dispose();

    expect(cancels).toHaveLength(2);
    for (const cancel of cancels) expect(cancel).toHaveBeenCalledOnce();
    for (const observed of [
      atmosphere.overlay,
      atmosphere.shadow,
      atmosphere.shadowLength,
      atmosphere.enableShadows,
    ]) {
      expect(observed.size("changed") ?? 0).toBe(0);
    }
  });
});
