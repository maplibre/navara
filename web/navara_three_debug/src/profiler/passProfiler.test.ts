import type { ViewContext } from "@navaramap/three";
import type { Pass } from "postprocessing";
import type { WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";

import { PassProfiler } from "./passProfiler";

class FakePass {
  rendered = 0;
  render(): void {
    this.rendered++;
    info.render.calls += 3;
    info.render.triangles += 30;
  }
}

const info = { render: { calls: 0, triangles: 0 } };

function fakeContext(passes: Map<string, FakePass>) {
  const listeners = new Set<() => void>();
  const ctx = {
    on: (_event: string, f: () => void) => listeners.add(f),
    off: (_event: string, f: () => void) => listeners.delete(f),
    emit: () => listeners.forEach((f) => f()),
    getPassNames: () => Array.from(passes.keys()),
    getPass: (name: string) => passes.get(name) as unknown as Pass,
  };
  return ctx as unknown as ViewContext & { emit(event: string): void };
}

const renderer = {
  info,
  getContext: () => ({ getExtension: () => null }),
} as unknown as WebGLRenderer;

describe("PassProfiler", () => {
  it("wraps pass render on the instance and restores it on disable", () => {
    const passes = new Map([["a", new FakePass()]]);
    const ctx = fakeContext(passes);
    const profiler = new PassProfiler(ctx, renderer);
    const a = passes.get("a") as FakePass;
    const prototypeRender = FakePass.prototype.render;

    profiler.enable();
    expect(Object.prototype.hasOwnProperty.call(a, "render")).toBe(true);
    profiler.beginTick(1);
    (a as unknown as Pass).render(renderer, null, null);
    expect(a.rendered).toBe(1);
    const sample = profiler.samples.get("a");
    expect(sample?.ran).toBe(true);

    expect(sample?.calls).toBe(3);
    expect(sample?.triangles).toBe(30);
    expect(sample?.gpuMs).toBeUndefined();

    profiler.disable();
    expect(Object.prototype.hasOwnProperty.call(a, "render")).toBe(false);
    expect(a.render).toBe(prototypeRender);
    expect(profiler.samples.size).toBe(0);
  });

  it("follows passesChanged: wraps new passes and unwraps removed ones", () => {
    const passes = new Map([["a", new FakePass()]]);
    const ctx = fakeContext(passes);
    const profiler = new PassProfiler(ctx, renderer);
    profiler.enable();

    const b = new FakePass();
    passes.set("b", b);
    passes.delete("a");
    ctx.emit("passesChanged");
    expect(Array.from(profiler.samples.keys())).toEqual(["b"]);
    expect(Object.prototype.hasOwnProperty.call(b, "render")).toBe(true);
    profiler.disable();
  });
});
