/** How closely interpolation between kept frames must match a dropped one. */
export type KeyframeTolerance = {
  /** Meters a cell's interpolated level may be off by. */
  maxLevelError: number;
  /**
   * Share of a frame's wet cells that may be off: in level by more than
   * `maxLevelError`, or, separately, wet or dry the wrong way further than
   * `shoreDistance` from the shoreline.
   */
  maxErrorShare: number;
  /** Meters from the shoreline within which wet or dry may be wrong. */
  shoreDistance: number;
};

/**
 * Indices of the frames to keep so that the water surface, interpolating
 * linearly in time between kept frames, draws each dropped frame within
 * `tolerance`. `levels` and `distances` are frame-major over `count` cells:
 * the levels extended past the shoreline as the surface draws them, and the
 * signed distances as stored. The first, last and widest frames are kept.
 */
export const keyframes = (
  times: ArrayLike<number>,
  levels: Float32Array,
  distances: Float32Array,
  count: number,
  { maxLevelError, maxErrorShare, shoreDistance }: KeyframeTolerance,
) => {
  const frameCount = times.length;
  const wetCounts = Array.from({ length: frameCount }, (_, k) => {
    let wet = 0;
    for (let n = 0; n < count; n++) wet += +(distances[k * count + n] < 0);
    return wet;
  });
  const widest = wetCounts.indexOf(Math.max(...wetCounts));

  // Whether frame `i` drawn between frames `a` and `b` is within tolerance.
  const fits = (a: number, i: number, b: number) => {
    const t = (times[i] - times[a]) / (times[b] - times[a]);
    let levelOff = 0;
    let shoreOff = 0;
    for (let n = 0; n < count; n++) {
      const d = distances[i * count + n];
      const drawn =
        distances[a * count + n] * (1 - t) + distances[b * count + n] * t;
      if (d < 0 !== drawn < 0) {
        if (Math.abs(d) > shoreDistance) shoreOff++;
      } else if (d < 0) {
        const level =
          levels[a * count + n] * (1 - t) + levels[b * count + n] * t;
        if (!(Math.abs(level - levels[i * count + n]) <= maxLevelError)) {
          levelOff++;
        }
      }
    }
    const allowed = maxErrorShare * wetCounts[i];
    return levelOff <= allowed && shoreOff <= allowed;
  };

  // From each kept frame, the furthest next one whose interpolation fits
  // every frame between; never past a frame that must be kept.
  const anchors = [...new Set([0, widest, frameCount - 1])].sort(
    (a, b) => a - b,
  );
  const kept = [0];
  for (let s = 1; s < anchors.length; s++) {
    let a = anchors[s - 1];
    for (let b = a + 2; b <= anchors[s]; b++) {
      for (let i = a + 1; i < b; i++) {
        if (!fits(a, i, b)) {
          a = b - 1;
          kept.push(a);
          break;
        }
      }
    }
    if (kept[kept.length - 1] !== anchors[s]) kept.push(anchors[s]);
  }
  return kept;
};
