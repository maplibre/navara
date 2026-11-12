/** The range of a property's values over the series. */
export type ValueRange = {
  min: number;
  max: number;
  /**
   * The 2nd and 98th percentiles of the values, from a sample: a range for
   * a color scale that leaves the outliers out, such as the speed at the
   * breach in its first moments.
   */
  low: number;
  high: number;
};

/** Array attributes a converter stores the range under; see `rangeOf`. */
export const ACTUAL_RANGE_ATTR = "actual_range";
export const ROBUST_RANGE_ATTR = "robust_range";

/** Values sampled for the percentiles. */
const PERCENTILE_SAMPLE = 1 << 16;

/** The range and percentiles of the values that are not NaN. */
export function rangeOf(values: ArrayLike<number>): ValueRange {
  let min = Infinity;
  let max = -Infinity;
  // Indexed: several times faster than an iterator over a typed array.
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    // NaN fails both comparisons.
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const stride = Math.max(1, Math.floor(values.length / PERCENTILE_SAMPLE));
  const sample = new Float64Array(Math.ceil(values.length / stride));
  let count = 0;
  for (let i = 0; i < values.length; i += stride) {
    const v = values[i];
    if (!Number.isNaN(v)) sample[count++] = v;
  }
  const sorted = sample.subarray(0, count).sort();
  const at = (p: number) =>
    count ? sorted[Math.round((count - 1) * p)] : Infinity;
  return { min, max, low: at(0.02), high: at(0.98) };
}

/** The range an array's attributes record, if they do. */
export function rangeFromAttributes(
  attrs: Record<string, unknown>,
): ValueRange | undefined {
  const pair = (value: unknown) =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => typeof v === "number")
      ? (value as [number, number])
      : undefined;
  const actual = pair(attrs[ACTUAL_RANGE_ATTR]);
  const robust = pair(attrs[ROBUST_RANGE_ATTR]);
  if (!actual || !robust) return undefined;
  return { min: actual[0], max: actual[1], low: robust[0], high: robust[1] };
}
