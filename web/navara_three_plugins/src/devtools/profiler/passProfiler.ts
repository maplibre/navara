import type { ViewContext } from "@navaramap/three";
import type { Pass } from "postprocessing";
import type { WebGLRenderer } from "three";

import { GpuTimer, type GpuTimerResult } from "./gpuTimer";

/**
 * Drawn frames in a row a pass may miss before its GPU time is dropped, so a
 * pass that skips some frames keeps its time while a disabled one loses it.
 */
const GPU_TIME_STALE_AFTER_MISSED_FRAMES = 10;

/** One pass's cost in the latest tick. */
export type PassSample = {
  name: string;
  /** Whether the composer ran the pass this tick (disabled passes are skipped). */
  ran: boolean;
  cpuMs: number;
  /**
   * GPU time of the latest tick whose queries resolved, summed over every
   * run of the pass in that tick; `undefined` without timer-query support,
   * and once several frames in a row were drawn without the pass.
   */
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
  /** Per pass, the GPU time summed so far for the newest tick resolved. */
  private readonly gpuSums = new Map<string, { tick: number; ms: number }>();
  private tick = 0;
  /** Per pass, the drawn frame (index in {@link drawnFrames}) it last ran in. */
  private readonly lastRun = new Map<string, number>();
  /** The last tick any pass ran in. */
  private lastDrawn = -1;
  /** Ticks in which any pass ran, counted since enabling. */
  private drawnFrames = 0;
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
    this.gpuSums.clear();
    this.lastRun.clear();
    this.lastDrawn = -1;
    this.drawnFrames = 0;
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
    // Results come in issue order, and one tick's queries for a pass may
    // resolve over several polls: sum them while the tick stays the same.
    for (const result of this.results) {
      const sample = this.samples.get(result.label);
      if (!sample) continue;
      let sum = this.gpuSums.get(result.label);
      if (!sum || sum.tick !== result.tick) {
        sum = { tick: result.tick, ms: 0 };
        this.gpuSums.set(result.label, sum);
      }
      sum.ms += result.ms;
      sample.gpuMs = sum.ms;
    }
    // A pass left out of many drawn frames in a row (disabled) has stopped
    // running; its last time would otherwise stay forever, also in sums.
    for (const [name, sample] of this.samples) {
      const missed = this.drawnFrames - (this.lastRun.get(name) ?? -Infinity);
      if (missed >= GPU_TIME_STALE_AFTER_MISSED_FRAMES) {
        sample.gpuMs = undefined;
      }
    }
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
    const ran = () => {
      if (this.lastDrawn !== this.tick) {
        this.lastDrawn = this.tick;
        this.drawnFrames++;
      }
      this.lastRun.set(name, this.drawnFrames);
    };
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
        ran();
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
    this.gpuSums.delete(entry.name);
    this.lastRun.delete(entry.name);
  }
}
