/** Fixed-capacity numeric history with the aggregates the panels show. */
export class RingBuffer {
  private readonly values: Float64Array;
  private next = 0;
  private count = 0;

  constructor(capacity: number) {
    this.values = new Float64Array(capacity);
  }

  push(value: number): void {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.values.length;
    if (this.count < this.values.length) this.count++;
  }

  get length(): number {
    return this.count;
  }

  get last(): number {
    if (this.count === 0) return 0;
    return this.values[
      (this.next - 1 + this.values.length) % this.values.length
    ];
  }

  average(): number {
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.values[i];
    return sum / this.count;
  }

  max(): number {
    let max = 0;
    for (let i = 0; i < this.count; i++) max = Math.max(max, this.values[i]);
    return max;
  }

  /** The value at the given quantile (0..1) of the held samples. */
  percentile(q: number): number {
    if (this.count === 0) return 0;
    const sorted = Array.from(this.values.subarray(0, this.count)).sort(
      (a, b) => a - b,
    );
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round(q * (sorted.length - 1))),
    );
    return sorted[index];
  }

  clear(): void {
    this.next = 0;
    this.count = 0;
  }
}
