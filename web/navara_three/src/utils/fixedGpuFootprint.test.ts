import type { EffectComposer, Pass } from "postprocessing";
import { DepthTexture, HalfFloatType, WebGLRenderTarget } from "three";
import { describe, expect, it } from "vitest";

import { estimateFixedGpuBytes, listRenderTargets } from "./fixedGpuFootprint";

const W = 100;
const H = 10;
const PX = W * H;

const named = (passes: Pass[]) =>
  passes.map((pass, i) => ({ name: `pass${i}`, pass }));

function composerWith(
  input: WebGLRenderTarget,
  output: WebGLRenderTarget,
): EffectComposer {
  return { inputBuffer: input, outputBuffer: output } as EffectComposer;
}

function rgba8Target(): WebGLRenderTarget {
  return new WebGLRenderTarget(W, H, { depthBuffer: false });
}

describe("estimateFixedGpuBytes", () => {
  it("sums composer buffers by texture type and depth attachment", () => {
    const input = new WebGLRenderTarget(W, H, {
      type: HalfFloatType,
      depthBuffer: true,
    });
    const output = new WebGLRenderTarget(W, H, { depthBuffer: false });
    const bytes = estimateFixedGpuBytes(composerWith(input, output), []);
    // input: RGBA16F (8) + depth (4); output: RGBA8 (4)
    expect(bytes).toBe(PX * (8 + 4) + PX * 4);
  });

  it("counts a render target reachable from two passes only once", () => {
    const shared = rgba8Target();
    const passes = [
      { renderTarget: shared } as unknown as Pass,
      { anotherRef: shared } as unknown as Pass,
    ];
    const bytes = estimateFixedGpuBytes(
      composerWith(rgba8Target(), rgba8Target()),
      named(passes),
    );

    expect(bytes).toBe(PX * 4 * 3);
  });

  it("finds targets nested in pass properties and arrays", () => {
    const nested = { copyPass: { target: rgba8Target() } } as unknown as Pass;
    const inArray = {
      effects: [{ renderTarget: rgba8Target() }],
    } as unknown as Pass;
    const bytes = estimateFixedGpuBytes(
      composerWith(rgba8Target(), rgba8Target()),
      named([nested, inArray]),
    );
    expect(bytes).toBe(PX * 4 * 4);
  });

  it("adds MSAA renderbuffer bytes on multisampled targets", () => {
    const msaa = new WebGLRenderTarget(W, H, {
      samples: 4,
      depthBuffer: true,
    });
    const bytes = estimateFixedGpuBytes(composerWith(msaa, rgba8Target()), []);
    // msaa: RGBA8 resolve (4) + depth (4) + 4 samples × (4 + 4); output: 4
    expect(bytes).toBe(PX * (4 + 4 + 4 * 8) + PX * 4);
  });

  it("counts every MRT attachment and depth textures in the MSAA term", () => {
    const mrt = new WebGLRenderTarget(W, H, {
      count: 2,
      samples: 2,
      depthBuffer: false,
    });
    mrt.textures[1].type = HalfFloatType;
    mrt.depthTexture = new DepthTexture(W, H);
    const bytes = estimateFixedGpuBytes(composerWith(mrt, rgba8Target()), []);
    // mrt: RGBA8 (4) + RGBA16F (8) + depth texture (4)
    //      + 2 samples × (4 + 8 + 4); output: 4
    expect(bytes).toBe(PX * (4 + 8 + 4 + 2 * 16) + PX * 4);
  });

  it("skips render targets that are not GL-allocated yet", () => {
    const allocated = rgba8Target();
    const lazy = rgba8Target();
    const composer = {
      inputBuffer: allocated,
      outputBuffer: lazy,
      getRenderer: () => ({
        properties: {
          get: (object: object) =>
            object === allocated ? { __webglFramebuffer: {} } : {},
        },
      }),
    } as unknown as EffectComposer;
    expect(estimateFixedGpuBytes(composer, [])).toBe(PX * 4);
  });

  it("does not walk into typed arrays or huge buffers", () => {
    const pass = {
      geometryData: new Float32Array(1_000_000),
      target: rgba8Target(),
    } as unknown as Pass;
    const bytes = estimateFixedGpuBytes(
      composerWith(rgba8Target(), rgba8Target()),
      named([pass]),
    );
    expect(bytes).toBe(PX * 4 * 3);
  });

  it("lists targets with their owning pass and allocation state", () => {
    const shared = rgba8Target();
    const own = rgba8Target();
    const input = rgba8Target();
    const output = rgba8Target();
    const entries = listRenderTargets(composerWith(input, output), [
      { name: "a", pass: { renderTarget: shared } as unknown as Pass },
      { name: "b", pass: { shared, own } as unknown as Pass },
    ]);
    const owner = (t: WebGLRenderTarget) =>
      entries.find((e) => e.target === t)?.owner;
    expect(entries).toHaveLength(4);
    expect(owner(input)).toBe("composer");
    expect(owner(shared)).toBe("a");
    expect(owner(own)).toBe("b");
    expect(entries.every((e) => e.bytes === PX * 4 && e.allocated)).toBe(true);
  });
});
