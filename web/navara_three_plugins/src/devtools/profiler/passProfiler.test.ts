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

  it("sums the GPU time of every run of a pass in one tick", () => {
    const passes = new Map([["a", new FakePass()]]);
    const ctx = fakeContext(passes);
    const queries: object[] = [];
    const results = new Map<object, number>();
    const gl = {
      QUERY_RESULT_AVAILABLE: 1,
      QUERY_RESULT: 2,
      getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
      createQuery: () => {
        const query = {};
        queries.push(query);
        return query;
      },
      deleteQuery: () => {},
      beginQuery: () => {},
      endQuery: () => {},
      getQueryParameter: (q: object, p: number) =>
        p === 1 ? results.has(q) : (results.get(q) ?? 0),
      getParameter: () => false,
    };
    const timed = {
      info,
      getContext: () => gl,
    } as unknown as WebGLRenderer;
    const profiler = new PassProfiler(ctx, timed);
    profiler.enable();
    const a = passes.get("a") as unknown as Pass;

    profiler.beginTick(1);
    a.render(timed, null, null);
    a.render(timed, null, null);
    // The first run resolves before the second: the sum spans two polls.
    results.set(queries[0], 2e6);
    profiler.beginTick(2);
    expect(profiler.samples.get("a")?.gpuMs).toBe(2);
    results.set(queries[1], 3e6);
    profiler.beginTick(3);
    expect(profiler.samples.get("a")?.gpuMs).toBe(5);
    profiler.dispose();
  });

  it("drops the GPU time of a pass that stopped running", () => {
    const passes = new Map([
      ["a", new FakePass()],
      ["b", new FakePass()],
    ]);
    const ctx = fakeContext(passes);
    const queries: object[] = [];
    const gl = {
      QUERY_RESULT_AVAILABLE: 1,
      QUERY_RESULT: 2,
      getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
      createQuery: () => {
        const query = {};
        queries.push(query);
        return query;
      },
      deleteQuery: () => {},
      beginQuery: () => {},
      endQuery: () => {},
      // Every query resolves at once, at 1 ms.
      getQueryParameter: (_q: object, p: number) => (p === 1 ? true : 1e6),
      getParameter: () => false,
    };
    const timed = { info, getContext: () => gl } as unknown as WebGLRenderer;
    const profiler = new PassProfiler(ctx, timed);
    profiler.enable();
    const a = passes.get("a") as unknown as Pass;
    const b = passes.get("b") as unknown as Pass;

    profiler.beginTick(1);
    a.render(timed, null, null);
    b.render(timed, null, null);
    profiler.beginTick(2);
    expect(profiler.samples.get("b")?.gpuMs).toBe(1);
    // "b" is disabled from tick 2 on; "a" keeps running. "b" keeps its time
    // for a few drawn frames, then loses it.
    let tick = 2;
    for (; tick < 11; tick++) {
      a.render(timed, null, null);
      profiler.beginTick(tick + 1);
      expect(profiler.samples.get("b")?.gpuMs).toBe(1);
    }
    a.render(timed, null, null);
    profiler.beginTick(tick + 1);
    expect(profiler.samples.get("a")?.gpuMs).toBe(1);
    expect(profiler.samples.get("b")?.gpuMs).toBeUndefined();
    profiler.dispose();
  });

  it("keeps the GPU time of a pass that skips a frame", () => {
    const passes = new Map([
      ["a", new FakePass()],
      ["b", new FakePass()],
    ]);
    const ctx = fakeContext(passes);
    const queries: object[] = [];
    const resolved = new Set<object>();
    const gl = {
      QUERY_RESULT_AVAILABLE: 1,
      QUERY_RESULT: 2,
      getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
      createQuery: () => {
        const query = {};
        queries.push(query);
        return query;
      },
      deleteQuery: () => {},
      beginQuery: () => {},
      endQuery: () => {},
      getQueryParameter: (q: object, p: number) =>
        p === 1 ? resolved.has(q) : 2e6,
      getParameter: () => false,
    };
    const timed = { info, getContext: () => gl } as unknown as WebGLRenderer;
    const profiler = new PassProfiler(ctx, timed);
    profiler.enable();
    const a = passes.get("a") as unknown as Pass;
    const b = passes.get("b") as unknown as Pass;

    profiler.beginTick(1);
    a.render(timed, null, null);
    b.render(timed, null, null);
    // "b" skips tick 2; its tick-1 query resolves only after that.
    profiler.beginTick(2);
    a.render(timed, null, null);
    queries.forEach((q) => resolved.add(q));
    profiler.beginTick(3);
    expect(profiler.samples.get("b")?.gpuMs).toBe(2);
    profiler.dispose();
  });

  it("keeps the GPU time while no frame is drawn", () => {
    const passes = new Map([["a", new FakePass()]]);
    const ctx = fakeContext(passes);
    let resolved = false;
    const gl = {
      QUERY_RESULT_AVAILABLE: 1,
      QUERY_RESULT: 2,
      getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
      createQuery: () => ({}),
      deleteQuery: () => {},
      beginQuery: () => {},
      endQuery: () => {},
      getQueryParameter: (_q: object, p: number) => (p === 1 ? resolved : 4e6),
      getParameter: () => false,
    };
    const timed = { info, getContext: () => gl } as unknown as WebGLRenderer;
    const profiler = new PassProfiler(ctx, timed);
    profiler.enable();
    profiler.beginTick(1);
    (passes.get("a") as unknown as Pass).render(timed, null, null);
    profiler.beginTick(2);
    // The result lands in an idle tick, after the last drawn frame.
    resolved = true;
    profiler.beginTick(3);
    profiler.beginTick(4);
    expect(profiler.samples.get("a")?.gpuMs).toBe(4);
    profiler.dispose();
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
