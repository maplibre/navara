// Compare independent paired rounds, not thousands of correlated frames.
export const mean = (values) =>
  values.reduce((sum, n) => sum + n, 0) / values.length;
export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};

export function compare(before, after) {
  if (
    !before.length ||
    before.length !== after.length ||
    [...before, ...after].some((n) => !Number.isFinite(n) || n <= 0)
  ) {
    throw new Error("Comparison requires complete, positive paired samples");
  }
  const improvement = (indices) =>
    100 *
    (1 -
      mean(indices.map((i) => after[i])) / mean(indices.map((i) => before[i])));
  const indices = before.map((_, i) => i);
  // Deterministic paired bootstrap of rounds. Keep each before/after pair together.
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const bootstrap = Array.from({ length: 5000 }, () =>
    improvement(indices.map(() => Math.floor(random() * indices.length))),
  );
  const interval = [percentile(bootstrap, 2.5), percentile(bootstrap, 97.5)];
  return {
    beforeMs: mean(before),
    afterMs: mean(after),
    improvementPct: improvement(indices),
    interval95Pct: interval,
    beforeRoundsMs: before,
    afterRoundsMs: after,
    verdict:
      before.length < 5
        ? "too few rounds"
        : interval[0] > 0
          ? "faster in this run"
          : interval[1] < 0
            ? "slower in this run"
            : "no clear difference",
  };
}

export function comparisonRow(name, comparison, digits = 3) {
  return {
    workload: name,
    "before ms": comparison.beforeMs.toFixed(digits),
    "after ms": comparison.afterMs.toFixed(digits),
    "improvement %": comparison.improvementPct.toFixed(1),
    "95% range %": comparison.interval95Pct
      .map((v) => v.toFixed(1))
      .join(" to "),
    result: comparison.verdict,
  };
}
