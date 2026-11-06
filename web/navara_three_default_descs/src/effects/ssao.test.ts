import { DepthTexture, PerspectiveCamera } from "three";
import { describe, expect, it, vi } from "vitest";

import { SSAO } from "./ssao";

// The package index boots the worker pool, which needs a browser.
vi.mock("@navaramap/three", async () => ({
  ...(await vi.importActual("../../../navara_three/src/effects/effect")),
  ...(await vi.importActual("../../../navara_three/src/Color")),
}));

describe("SSAO.dispose", () => {
  it("does not dispose the composer's depth texture", () => {
    const ssao = new SSAO(new PerspectiveCamera(), 4, 4);
    const depth = new DepthTexture(4, 4);
    const dispose = vi.spyOn(depth, "dispose");
    ssao.rawPass.setDepthTexture(depth);

    ssao.dispose();

    expect(dispose).not.toHaveBeenCalled();
  });
});
