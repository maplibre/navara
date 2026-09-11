import assert from "node:assert/strict";
import test from "node:test";
import { compare, mean, median, percentile } from "./bench-stats.mjs";

test("summary statistics use milliseconds and nearest-rank percentiles", () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(percentile([4, 1, 3, 2], 95), 4);
});

test("positive improvement means less time, calculated from paired rounds", () => {
  const result = compare([10, 20, 30, 40, 50], [8, 16, 24, 32, 40]);
  assert.ok(Math.abs(result.improvementPct - 20) < 1e-10);
  assert.equal(result.beforeMs, 30);
  assert.equal(result.afterMs, 24);
  assert.equal(result.verdict, "faster in this run");
});

test("noise and insufficient rounds do not produce a speedup claim", () => {
  assert.equal(
    compare([10, 10, 10, 10, 10, 10], [9, 11, 9, 11, 9, 11]).verdict,
    "no clear difference",
  );
  assert.equal(compare([10], [1]).verdict, "too few rounds");
  assert.equal(
    compare([1, 1, 1, 1, 1], [2, 2, 2, 2, 2]).verdict,
    "slower in this run",
  );
});

test("incomplete or invalid samples are rejected", () => {
  for (const [before, after] of [
    [[], []],
    [[1], [1, 2]],
    [[0], [1]],
    [[1], [NaN]],
  ]) {
    assert.throws(() => compare(before, after));
  }
});
