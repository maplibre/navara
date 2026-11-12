import { Pass as PostProcessingPass } from "postprocessing";
import invariant from "tiny-invariant";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Pass } from "../effects";
import type ThreeView from "../index";
import { initTestEngine } from "../test-utils/engine";

import { EffectHandle } from "./BaseHandle";
import { EffectDesc, type EffectConfig } from "./EffectDesc";
import type { ViewContext } from "./ViewContext";

type TestInstance = { raw: PostProcessingPass; visible: boolean };

class TestEffectDesc extends EffectDesc<EffectConfig, object, TestInstance> {
  static key = "testEffect";

  createPass(): TestInstance {
    return { raw: new PostProcessingPass("TestEffectPass"), visible: true };
  }
}

class WrappedEffectDesc extends EffectDesc<
  EffectConfig,
  object,
  Pass<PostProcessingPass, null>
> {
  static key = "wrappedEffect";

  createPass() {
    return new Pass(new PostProcessingPass("WrappedEffectPass"), null);
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

  it("disposes the pass it created", () => {
    const ctx = makeCtx();
    const desc = new TestEffectDesc({} as ThreeView, ctx, {});
    desc.onCreate();
    const dispose = vi.spyOn(
      desc.raw as unknown as PostProcessingPass,
      "dispose",
    );

    desc.onDestroy();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes a Pass wrapper through its own dispose", () => {
    const ctx = makeCtx();
    const desc = new WrappedEffectDesc({} as ThreeView, ctx, {});
    desc.onCreate();
    const wrapper = desc.raw;
    invariant(wrapper);
    const wrapperDispose = vi.spyOn(wrapper, "dispose");
    const rawDispose = vi.spyOn(wrapper.rawPass, "dispose");

    desc.onDestroy();

    expect(wrapperDispose).toHaveBeenCalledOnce();
    expect(rawDispose).toHaveBeenCalledOnce();
  });

  it("finishes the destroy when the pass's dispose throws", () => {
    const ctx = makeCtx();
    const desc = new TestEffectDesc({} as ThreeView, ctx, {});
    desc.onCreate();
    vi.spyOn(
      desc.raw as unknown as PostProcessingPass,
      "dispose",
    ).mockImplementation(() => {
      throw new Error("dispose failed");
    });
    const handle = new EffectHandle(desc);
    const deleted = vi.fn();
    handle.on("deleted", deleted);

    expect(() => handle.delete()).toThrow("dispose failed");

    expect(desc.destroyed).toBe(true);
    expect(deleted).toHaveBeenCalledOnce();
  });
});
