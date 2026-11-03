import type { FrameTiming } from "@navaramap/three";

import { RingBuffer } from "../util/ring";

/** Ticks older than this no longer count toward the rates. */
const RATE_WINDOW_MS = 1000;
const HISTORY = 240;

/** Aggregates of the `frame` event over the recent history. */
export class FrameStats {
  readonly total = new RingBuffer(HISTORY);
  readonly update = new RingBuffer(HISTORY);
  readonly events = new RingBuffer(HISTORY);
  readonly render = new RingBuffer(HISTORY);
  private readonly tickTimes: number[] = [];
  private readonly renderTimes: number[] = [];
  private last: FrameTiming | undefined;

  push(timing: FrameTiming): void {
    this.last = { ...timing };
    this.total.push(timing.totalMs);
    this.update.push(timing.updateMs);
    this.events.push(timing.eventsMs);
    this.render.push(timing.renderMs);
    const now = performance.now();
    this.tickTimes.push(now);
    if (timing.rendered) this.renderTimes.push(now);
    trim(this.tickTimes, now);
    trim(this.renderTimes, now);
  }

  /** The latest tick's timings, or `undefined` before the first one. */
  get latest(): FrameTiming | undefined {
    return this.last;
  }

  /** Loop ticks per second over the last second. */
  ticksPerSecond(now = performance.now()): number {
    trim(this.tickTimes, now);
    return this.tickTimes.length;
  }

  /** Rendered frames per second over the last second. */
  framesPerSecond(now = performance.now()): number {
    trim(this.renderTimes, now);
    return this.renderTimes.length;
  }

  clear(): void {
    this.total.clear();
    this.update.clear();
    this.events.clear();
    this.render.clear();
    this.tickTimes.length = 0;
    this.renderTimes.length = 0;
    this.last = undefined;
  }
}

function trim(times: number[], now: number): void {
  while (times.length > 0 && now - times[0] > RATE_WINDOW_MS) times.shift();
}
