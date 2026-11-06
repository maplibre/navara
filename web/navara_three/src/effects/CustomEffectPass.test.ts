import { Texture } from "three";
import { describe, expect, it, vi } from "vitest";

import { CustomEffectPass } from "./CustomEffectPass";

describe("CustomEffectPass.dispose", () => {
  it("does not dispose the custom depth texture it reads", () => {
    const pass = new CustomEffectPass();
    const depth = new Texture();
    const dispose = vi.spyOn(depth, "dispose");
    pass.setCustomDepthTexture(depth);

    pass.dispose();

    expect(dispose).not.toHaveBeenCalled();
  });
});
