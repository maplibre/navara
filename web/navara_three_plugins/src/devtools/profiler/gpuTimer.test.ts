import { describe, expect, it } from "vitest";

import { GpuTimer, type GpuTimerResult } from "./gpuTimer";

const EXT = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };

type Query = { id: number };

function fakeGl(options: { disjoint?: boolean } = {}) {
  const queries: Query[] = [];
  const results = new Map<Query, number>();
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    created: 0,
    deleted: 0,
    getExtension: () => EXT,
    createQuery: () => {
      gl.created++;
      const query = { id: queries.length };
      queries.push(query);
      return query;
    },
    deleteQuery: () => {
      gl.deleted++;
    },
    beginQuery: () => {},
    endQuery: () => {},
    getQueryParameter: (q: Query, p: number) =>
      p === 1 ? results.has(q) : (results.get(q) ?? 0),
    getParameter: () => options.disjoint ?? false,
    /** Test hook: resolves the i-th created query with `ns` nanoseconds. */
    resolve: (i: number, ns: number) => {
      results.set(queries[i], ns);
    },
  };
  return gl;
}

describe("GpuTimer", () => {
  it("reports results in order and reuses queries", () => {
    const gl = fakeGl();
    const timer = new GpuTimer(gl as unknown as WebGL2RenderingContext);
    expect(timer.supported).toBe(true);
    expect(timer.begin("a", 1)).toBe(true);
    expect(timer.begin("nested", 1)).toBe(false);
    timer.end();
    expect(timer.begin("b", 1)).toBe(true);
    timer.end();

    const out: GpuTimerResult[] = [];

    timer.poll(out);
    expect(out).toEqual([]);
    gl.resolve(0, 2_000_000);
    timer.poll(out);
    expect(out).toEqual([{ label: "a", tick: 1, ms: 2 }]);
    gl.resolve(1, 500_000);
    timer.poll(out);
    expect(out.map((r) => r.label)).toEqual(["a", "b"]);

    timer.begin("c", 2);
    timer.end();
    expect(gl.created).toBe(2);
  });

  it("drops results of a disjoint interval", () => {
    const gl = fakeGl({ disjoint: true });
    const timer = new GpuTimer(gl as unknown as WebGL2RenderingContext);
    timer.begin("a", 1);
    timer.end();
    gl.resolve(0, 1_000_000);
    const out: GpuTimerResult[] = [];
    timer.poll(out);
    expect(out).toEqual([]);
  });

  it("is a no-op without the extension", () => {
    const gl = { getExtension: () => null };
    const timer = new GpuTimer(gl as unknown as WebGL2RenderingContext);
    expect(timer.supported).toBe(false);
    expect(timer.begin("a", 1)).toBe(false);
    timer.end();
    timer.poll([]);
  });
});
