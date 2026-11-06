import type { FrameTiming } from "@navaramap/three";

import { RingBuffer } from "../util/ring";

/** Ticks older than this no longer count toward the rates. */
const RATE_WINDOW_MS = 1000;
/** Drawn frames kept for the averages (about 4 s at 60 fps). */
const HISTORY = 240;

/**
 * Aggregates of the `frame` event. Navara draws only when something changed,
 * so the averages cover drawn frames only: idle ticks cost next to nothing
 * and would hide the cost of the frames that matter.
 */
export class FrameStats {
  /** Whole-tick CPU ms of drawn frames. */
  readonly cpu = new RingBuffer(HISTORY);
  private readonly tickTimes: number[] = [];
  private readonly drawTimes: number[] = [];
  private lastDrawn: FrameTiming | undefined;

  push(timing: FrameTiming): void {
    const now = performance.now();
    this.tickTimes.push(now);
    if (timing.rendered) {
      this.cpu.push(timing.totalMs);
      this.drawTimes.push(now);
      this.lastDrawn = { ...timing };
    }
    trim(this.tickTimes, now);
    trim(this.drawTimes, now);
  }

  /** The latest drawn frame's timings, or `undefined` before the first. */
  get latest(): FrameTiming | undefined {
    return this.lastDrawn;
  }

  /** Animation-loop ticks per second (the display's refresh rate). */
  ticksPerSecond(now = performance.now()): number {
    trim(this.tickTimes, now);
    return this.tickTimes.length;
  }

  /** Drawn frames per second over the last second; 0 while idle. */
  framesPerSecond(now = performance.now()): number {
    trim(this.drawTimes, now);
    return this.drawTimes.length;
  }

  clear(): void {
    this.cpu.clear();
    this.tickTimes.length = 0;
    this.drawTimes.length = 0;
    this.lastDrawn = undefined;
  }
}

function trim(times: number[], now: number): void {
  while (times.length > 0 && now - times[0] > RATE_WINDOW_MS) times.shift();
}
