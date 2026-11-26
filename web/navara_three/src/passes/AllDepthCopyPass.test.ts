import {
  FloatType,
  RGBAFormat,
  RedFormat,
  UnsignedByteType,
  type Material,
  type Mesh,
  type Scene,
  type ShaderMaterial,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";

import { AllDepthCopyPass } from "./AllDepthCopyPass";

/** Records the fragment shader of every fullscreen draw. */
function recordingRenderer() {
  const draws: { shader: string; target: WebGLRenderTarget | null }[] = [];
  let target: WebGLRenderTarget | null = null;
  const renderer = {
    setRenderTarget: (t: WebGLRenderTarget | null) => {
      target = t;
    },
    render: (scene: Scene) => {
      const mesh = scene.children[0] as Mesh<never, Material>;
      draws.push({
        shader: (mesh.material as ShaderMaterial).fragmentShader,
        target,
      });
    },
  } as unknown as WebGLRenderer;
  return { renderer, draws };
}

describe("AllDepthCopyPass", () => {
  it("copies a reversed depth into a one-channel float target (R32F)", () => {
    const pass = new AllDepthCopyPass(undefined, true);
    expect(pass.texture.format).toBe(RedFormat);
    expect(pass.texture.type).toBe(FloatType);
    pass.dispose();
  });

  it("keeps RGBA8 for a packed (non-reversed) depth", () => {
    const pass = new AllDepthCopyPass(undefined, false);
    expect(pass.texture.format).toBe(RGBAFormat);
    expect(pass.texture.type).toBe(UnsignedByteType);
    pass.dispose();
  });

  it("copies the previous depth for a merge through a highp sampler", () => {
    const pass = new AllDepthCopyPass(undefined, true);
    const { renderer, draws } = recordingRenderer();
    pass.copyDepth(true);
    pass.render(renderer, null, null);

    // The copy of the previous result, then the merge into the target.
    expect(draws).toHaveLength(2);
    const copy = draws[0];
    expect(copy.target).not.toBe(null);
    expect(copy.target?.texture.format).toBe(RedFormat);
    expect(copy.shader).toMatch(/uniform\s+highp\s+sampler2D\s+inputBuffer/);
    expect(copy.shader).not.toMatch(/(lowp|mediump)\s+sampler2D/);
    expect(draws[1].target?.texture).toBe(pass.texture);
    pass.dispose();
  });
});
