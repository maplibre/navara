/** A `setInterval` that can be started and stopped repeatedly. */
export class Ticker {
  private handle: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly intervalMs: number,
    private readonly fn: () => void,
  ) {}

  start(): void {
    if (this.handle !== undefined) return;
    this.handle = setInterval(this.fn, this.intervalMs);
  }

  stop(): void {
    if (this.handle === undefined) return;
    clearInterval(this.handle);
    this.handle = undefined;
  }
}
