import { Pass as PostProcessingPass } from "postprocessing";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type ThreeView from "../index";
import { initTestEngine } from "../test-utils/engine";

import { EffectDesc, type EffectConfig } from "./EffectDesc";
import type { ViewContext } from "./ViewContext";

type TestInstance = { raw: PostProcessingPass; visible: boolean };

class TestEffectDesc extends EffectDesc<EffectConfig, object, TestInstance> {
  static key = "testEffect";

  createPass(): TestInstance {
    return { raw: new PostProcessingPass("TestEffectPass"), visible: true };
  }
}

const makeCtx = () => {
  const passes = new Map<string, PostProcessingPass>();
  return {
    getPass: vi.fn((name: string) => passes.get(name)),
    addPass: vi.fn((name: string, pass: PostProcessingPass) => {
      passes.set(name, pass);
    }),
    removePass: vi.fn((name: string) => {
      if (!passes.has(name)) throw new Error(`Pass not found: ${name}`);
      passes.delete(name);
    }),
    insertPassAfter: vi.fn(),
    insertPassBefore: vi.fn(),
  } as unknown as ViewContext & { removePass: ReturnType<typeof vi.fn> };
};

// `BaseDesc` generates ids through the WASM engine when the config carries
// none, so the module has to be initialized for the constructor to run.
beforeAll(initTestEngine);

describe("EffectDesc.onDestroy", () => {
  it("does not remove a pass for a descriptor that was never created", () => {
    const ctx = makeCtx();
    const desc = new TestEffectDesc({} as ThreeView, ctx, {});

    expect(() => desc.onDestroy()).not.toThrow();
    expect(ctx.removePass).not.toHaveBeenCalled();
    expect(desc.destroyed).toBe(true);
  });

  it("removes the pass registered by onCreate", () => {
    const ctx = makeCtx();
    const desc = new TestEffectDesc({} as ThreeView, ctx, {});
    desc.onCreate();
    expect(ctx.getPass("testEffect")).toBeDefined();

    desc.onDestroy();

    expect(ctx.removePass).toHaveBeenCalledWith("testEffect");
    expect(ctx.getPass("testEffect")).toBeUndefined();
    expect(desc.raw).toBeUndefined();
    expect(desc.destroyed).toBe(true);
  });
});
