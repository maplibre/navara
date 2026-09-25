/**
 * How long (ms) a distance sample stays usable after it was taken. Covers the
 * GPU round trip of an async refresh at low frame rates, so a continuous
 * gesture never blocks once its first sample is in.
 */
export const TERRAIN_DISTANCE_MAX_AGE_MS = 250;

/**
 * Camera-to-surface distance for the input handlers, served from a cache
 * that refreshes without blocking the CPU.
 *
 * The distance only scales input deltas (zoom step, rotate ratio), so a
 * sample a frame or two old is as good as an exact one. High-rate events
 * (wheel, one per few ms) therefore read the cached value and kick an async
 * readback when none is in flight; only a gesture starting after
 * {@link TERRAIN_DISTANCE_MAX_AGE_MS} of no sampling pays for a blocking
 * readback, once, so its first delta is scaled correctly too.
 */
export class TerrainDistanceCache {
  private distance: number | null = null;
  private sampledAt = -Infinity;
  private refreshing = false;

  constructor(
    private readonly pickSync: () => number | null,
    private readonly pickAsync: () => Promise<number | null>,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get(): number | null {
    const now = this.now();
    // A refresh still in flight past the age limit is closer to landing
    // than a blocking sample would be, so it doesn't trigger one.
    if (
      !this.refreshing &&
      now - this.sampledAt > TERRAIN_DISTANCE_MAX_AGE_MS
    ) {
      this.distance = this.pickSync();
      this.sampledAt = now;
    } else {
      this.refresh();
    }
    return this.distance;
  }

  private refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.pickAsync().then(
      (distance) => {
        this.refreshing = false;
        this.distance = distance;
        this.sampledAt = this.now();
      },
      () => {
        // The readback failed (e.g. the renderer was disposed mid-flight);
        // the next `get` past the age limit falls back to a sync sample.
        this.refreshing = false;
      },
    );
  }
}
