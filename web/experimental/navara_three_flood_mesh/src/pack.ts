/**
 * CF-style packing of a float field into the smallest integer type that
 * holds it at a given precision: `stored = round((value - offset) / scale)`,
 * read back as `stored * scale + offset`, as the Zarr writer stores fields.
 */

export type PackedDtype = "uint8" | "int16" | "uint16" | "float32";

export type PackingPlan = {
  dtype: PackedDtype;
  /** CF `scale_factor`; 1 for float32. */
  scale: number;
  /** CF `add_offset`; 0 for float32. */
  offset: number;
  /** The fill value marking a missing value. */
  fill: number;
};

export type PackedArray = Uint8Array | Int16Array | Uint16Array | Float32Array;

const FILL: Record<PackedDtype, number> = {
  uint8: 255,
  int16: -32768,
  uint16: 65535,
  float32: NaN,
};

/**
 * The smallest storage for values in `[min, max]` at steps of `precision`:
 * uint8, then uint16, else float32, which also serves without a precision.
 */
export const planPacking = (
  min: number,
  max: number,
  precision?: number,
): PackingPlan => {
  if (
    precision !== undefined &&
    precision > 0 &&
    Number.isFinite(min) &&
    Number.isFinite(max)
  ) {
    const steps = Math.round((max - min) / precision);
    // The top code of each type is its fill value.
    const dtype =
      steps <= 254 ? "uint8" : steps <= 65534 ? "uint16" : undefined;
    if (dtype)
      return { dtype, scale: precision, offset: min, fill: FILL[dtype] };
  }
  return { dtype: "float32", scale: 1, offset: 0, fill: NaN };
};

/** Packs `values` by `plan`; NaN becomes the fill value. */
export const pack = (
  values: ArrayLike<number>,
  plan: PackingPlan,
): PackedArray => {
  if (plan.dtype === "float32") return Float32Array.from(values);
  const out =
    plan.dtype === "uint8"
      ? new Uint8Array(values.length)
      : plan.dtype === "int16"
        ? new Int16Array(values.length)
        : new Uint16Array(values.length);
  const [low, high] =
    plan.dtype === "int16" ? [-32767, 32767] : [0, plan.fill - 1];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = Number.isNaN(v)
      ? plan.fill
      : Math.max(
          low,
          Math.min(high, Math.round((v - plan.offset) / plan.scale)),
        );
  }
  return out;
};
