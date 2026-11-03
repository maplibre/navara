import type { ViewContext } from "@navaramap/three";
import type { Pass } from "postprocessing";
import type { WebGLRenderer } from "three";

import { GpuTimer, type GpuTimerResult } from "./gpuTimer";

/** One pass's cost in the latest tick. */
export type PassSample = {
  name: string;
  /** Whether the composer ran the pass this tick (disabled passes are skipped). */
  ran: boolean;
  cpuMs: number;
  /** Latest resolved GPU time; `undefined` without timer-query support. */
  gpuMs: number | undefined;
  calls: number;
  triangles: number;
};

type Wrapped = {
  name: string;
  /** The own `render` property that existed before wrapping, if any. */
  own: PropertyDescriptor | undefined;
};

type PassRender = Pass["render"];

/**
 * Times every registered pass by wrapping its `render` as an own property on
 * the instance (postprocessing's composer looks `pass.render` up on each
 * call). CPU time comes from `performance.now()`, draw calls and triangles
 * from `renderer.info` deltas, GPU time from {@link GpuTimer}. Wrapping is
 * undone on `disable()` and kept in sync with the pipeline through the
 * context's `passesChanged` event.
 */
export class PassProfiler {
  readonly samples = new Map<string, PassSample>();
  readonly gpu: GpuTimer;
  private readonly wrapped = new Map<Pass, Wrapped>();
  private readonly results: GpuTimerResult[] = [];
  private tick = 0;
  private enabled = false;

  constructor(
    private readonly ctx: ViewContext,
    private readonly renderer: WebGLRenderer,
  ) {
    this.gpu = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.ctx.on("passesChanged", this.sync);
    this.sync();
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.ctx.off("passesChanged", this.sync);
    for (const pass of Array.from(this.wrapped.keys())) this.unwrap(pass);
    this.samples.clear();
  }

  /** Starts a tick: clears the per-tick counters and collects GPU results. */
  beginTick(tick: number): void {
    this.tick = tick;
    for (const sample of this.samples.values()) {
      sample.ran = false;
      sample.cpuMs = 0;
      sample.calls = 0;
      sample.triangles = 0;
    }
    this.results.length = 0;
    this.gpu.poll(this.results);
    for (const result of this.results) {
      const sample = this.samples.get(result.label);
      if (sample) sample.gpuMs = result.ms;
    }
  }

  /** Sum over the passes that ran this tick. */
  totals(): { cpuMs: number; gpuMs: number | undefined; calls: number } {
    let cpuMs = 0;
    let gpuMs = 0;
    let calls = 0;
    let gpuKnown = false;
    for (const sample of this.samples.values()) {
      if (!sample.ran) continue;
      cpuMs += sample.cpuMs;
      calls += sample.calls;
      if (sample.gpuMs !== undefined) {
        gpuMs += sample.gpuMs;
        gpuKnown = true;
      }
    }
    return { cpuMs, gpuMs: gpuKnown ? gpuMs : undefined, calls };
  }

  dispose(): void {
    this.disable();
    this.gpu.dispose();
  }

  private readonly sync = (): void => {
    const names = this.ctx.getPassNames();
    const live = new Set<Pass>();
    for (const name of names) {
      const pass = this.ctx.getPass(name);
      if (!pass) continue;
      live.add(pass);
      if (!this.wrapped.has(pass)) this.wrap(name, pass);
    }
    for (const pass of Array.from(this.wrapped.keys())) {
      if (!live.has(pass)) this.unwrap(pass);
    }
    // Keep the sample table in pipeline order.
    const ordered = new Map<string, PassSample>();
    for (const name of names) {
      const sample = this.samples.get(name);
      if (sample) ordered.set(name, sample);
    }
    this.samples.clear();
    for (const [name, sample] of ordered) this.samples.set(name, sample);
  };

  private wrap(name: string, pass: Pass): void {
    const own = Object.getOwnPropertyDescriptor(pass, "render");
    const original: PassRender = pass.render;
    const sample: PassSample = {
      name,
      ran: false,
      cpuMs: 0,
      gpuMs: undefined,
      calls: 0,
      triangles: 0,
    };
    this.samples.set(name, sample);
    this.wrapped.set(pass, { name, own });
    const gpu = this.gpu;
    const currentTick = () => this.tick;
    const renderer = this.renderer;
    pass.render = function (
      this: Pass,
      r: WebGLRenderer,
      input: Parameters<PassRender>[1],
      output: Parameters<PassRender>[2],
      deltaTime?: number,
      stencilTest?: boolean,
    ) {
      const info = renderer.info.render;
      const calls = info.calls;
      const triangles = info.triangles;
      const start = performance.now();
      const timed = gpu.begin(name, currentTick());
      try {
        return original.call(this, r, input, output, deltaTime, stencilTest);
      } finally {
        if (timed) gpu.end();

        sample.ran = true;
        sample.cpuMs += performance.now() - start;
        sample.calls += info.calls - calls;
        sample.triangles += info.triangles - triangles;
      }
    };
  }

  private unwrap(pass: Pass): void {
    const entry = this.wrapped.get(pass);
    if (!entry) return;
    if (entry.own) Object.defineProperty(pass, "render", entry.own);
    else delete (pass as Partial<Pass>).render;
    this.wrapped.delete(pass);
    this.samples.delete(entry.name);
  }
}
