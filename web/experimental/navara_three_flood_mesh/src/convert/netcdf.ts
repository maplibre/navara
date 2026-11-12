/**
 * Reads netCDF files: classic (CDF-1, CDF-2) as they are, and netCDF-4,
 * which is HDF5, with the optional peer dependency `h5wasm`.
 */
import type * as H5Wasm from "h5wasm";

import { readInput, type Input } from "./input";

export type Attributes = Record<string, number[] | string>;

/** A variable of a netCDF file: its shape, attributes and values. */
export type NetcdfVariable = {
  /** Lengths of its dimensions; of the record dimension, the record count. */
  shape: number[];
  attributes: Attributes;
  /**
   * Its values, row-major: all of them, or with `k`, those at index `k` of
   * its first dimension, such as one time step.
   */
  read: (k?: number) => ArrayLike<number>;
};

export type Netcdf = {
  name: string;
  attributes: Attributes;
  variables: Map<string, NetcdfVariable>;
};

let h5wasmLoading: Promise<typeof H5Wasm> | undefined;

// An optional peer dependency, needed only to read HDF5 (netCDF-4) files.
// The specifier is hidden from bundlers.
function loadH5wasm(): Promise<typeof H5Wasm> {
  const specifier = "h5wasm";
  h5wasmLoading ??= (
    import(/* @vite-ignore */ specifier) as Promise<typeof H5Wasm>
  ).then(
    async (module) => {
      await module.ready;
      return module;
    },
    (error: unknown) => {
      h5wasmLoading = undefined;
      throw new Error(
        `Reading netCDF-4 files needs the h5wasm package; install it. (${String(error)})`,
      );
    },
  );
  return h5wasmLoading;
}

const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

/** `value`, an attribute or a dataset's values, as numbers or a string. */
const numbersOf = (value: unknown): ArrayLike<number> | string | undefined => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return [Number(value)];
  }
  if (value instanceof BigInt64Array || value instanceof BigUint64Array) {
    return Float64Array.from(value, Number);
  }
  if (ArrayBuffer.isView(value)) return value as unknown as ArrayLike<number>;
  return undefined;
};

const attributesOf = (attrs: Record<string, { value: unknown }>) => {
  const attributes: Attributes = {};
  for (const [name, attribute] of Object.entries(attrs)) {
    const value = numbersOf(attribute.value);
    if (value !== undefined) {
      attributes[name] = typeof value === "string" ? value : Array.from(value);
    }
  }
  return attributes;
};

/**
 * Calls `visit` with a netCDF-4 file read with h5wasm, which holds it only
 * until `visit` settles. Only the datasets at the root are read.
 */
const withHdf5 = async <T>(
  name: string,
  bytes: Uint8Array,
  visit: (file: Netcdf) => T | Promise<T>,
): Promise<T> => {
  const h5wasm = await loadH5wasm();
  const { FS } = await h5wasm.ready;
  const path = `/netcdf-${Math.random().toString(36).slice(2)}.nc`;
  FS.writeFile(path, bytes);
  let file: InstanceType<typeof h5wasm.File>;
  try {
    file = new h5wasm.File(path, "r");
  } catch (error) {
    FS.unlink(path);
    throw error;
  }
  try {
    const variables = new Map<string, NetcdfVariable>();
    for (const key of file.keys()) {
      const dataset = file.get(key);
      if (!(dataset instanceof h5wasm.Dataset)) continue;
      const values = (value: unknown) => {
        const numbers = numbersOf(value);
        if (numbers === undefined || typeof numbers === "string") {
          throw new Error(`${name}: ${key} is not numeric.`);
        }
        return numbers;
      };
      variables.set(key, {
        shape: dataset.shape ?? [],
        attributes: attributesOf(dataset.attrs),
        read: (k) =>
          values(k === undefined ? dataset.value : dataset.slice([[k, k + 1]])),
      });
    }
    return await visit({
      name,
      attributes: attributesOf(file.attrs),
      variables,
    });
  } finally {
    file.close();
    FS.unlink(path);
  }
};

// Sizes in bytes of the classic netCDF types, by type code.
const CLASSIC_SIZES = [0, 1, 1, 2, 4, 4, 8];
const STREAMING = -1;

/** A classic netCDF file (CDF-1 or CDF-2), which does not need h5wasm. */
const classicOf = (name: string, bytes: Uint8Array): Netcdf => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[3];
  let at = 4;
  const int = () => {
    const value = view.getInt32(at);
    at += 4;
    return value;
  };
  const padded = (length: number) => (at += Math.ceil(length / 4) * 4);
  const text = () => {
    const length = int();
    const value = new TextDecoder().decode(bytes.subarray(at, at + length));
    padded(length);
    return value;
  };
  const read = (type: number, count: number, offset: number) => {
    const values = new Float64Array(count);
    const size = CLASSIC_SIZES[type];
    for (let i = 0; i < count; i++) {
      const p = offset + i * size;
      values[i] =
        type === 1 || type === 2
          ? view.getInt8(p)
          : type === 3
            ? view.getInt16(p)
            : type === 4
              ? view.getInt32(p)
              : type === 5
                ? view.getFloat32(p)
                : view.getFloat64(p);
    }
    return values;
  };
  const attributeList = () => {
    const attributes: Attributes = {};
    int(); // NC_ATTRIBUTE or ABSENT
    const count = int();
    for (let i = 0; i < count; i++) {
      const key = text();
      const type = int();
      const length = int();
      attributes[key] =
        type === 2
          ? new TextDecoder()
              .decode(bytes.subarray(at, at + length))
              .replace(/\0+$/, "")
          : Array.from(read(type, length, at));
      padded(length * CLASSIC_SIZES[type]);
    }
    return attributes;
  };

  let records = int();
  int(); // NC_DIMENSION or ABSENT
  const dimensions: number[] = [];
  const dimensionCount = int();
  for (let i = 0; i < dimensionCount; i++) {
    text();
    dimensions.push(int());
  }
  const attributes = attributeList();
  int(); // NC_VARIABLE or ABSENT
  const headers = Array.from({ length: int() }, () => {
    const key = text();
    const shape = Array.from({ length: int() }, int).map(
      (id) => dimensions[id],
    );
    const variableAttributes = attributeList();
    const type = int();
    const vsize = int();
    const begin = version === 2 ? Number(view.getBigInt64(at)) : int();
    if (version === 2) at += 8;
    // A record variable has the unlimited dimension, of length 0, first.
    const record = shape[0] === 0;
    return {
      key,
      shape,
      attributes: variableAttributes,
      type,
      vsize,
      begin,
      record,
    };
  });

  // The records interleave the record variables, each padded to 4 bytes but
  // when it is the only one.
  const recordVariables = headers.filter((v) => v.record);
  const sliceCount = (shape: number[]) =>
    shape.slice(1).reduce((a, b) => a * b, 1);
  const recordSize =
    recordVariables.length === 1
      ? sliceCount(recordVariables[0].shape) *
        CLASSIC_SIZES[recordVariables[0].type]
      : recordVariables.reduce((sum, v) => sum + v.vsize, 0);
  if (records === STREAMING && recordVariables.length) {
    records = Math.floor(
      (bytes.length - recordVariables[0].begin) / recordSize,
    );
  }

  const variables = new Map<string, NetcdfVariable>();
  for (const { key, shape, attributes, type, begin, record } of headers) {
    if (record) shape[0] = records;
    const inner = sliceCount(shape);
    const stride = record ? recordSize : inner * CLASSIC_SIZES[type];
    variables.set(key, {
      shape,
      attributes,
      read: (k) => {
        if (k !== undefined) return read(type, inner, begin + k * stride);
        if (!record) return read(type, inner * (shape[0] ?? 1), begin);
        const values = new Float64Array(inner * records);
        for (let r = 0; r < records; r++) {
          values.set(read(type, inner, begin + r * stride), r * inner);
        }
        return values;
      },
    });
  }
  return { name, attributes, variables };
};

/**
 * Calls `visit` with the netCDF file of `input`, which stays readable until
 * `visit` settles. Classic netCDF is read as it is; netCDF-4 is HDF5, read
 * with the optional peer dependency `h5wasm`.
 */
export const withNetcdf = async <T>(
  input: Input,
  visit: (file: Netcdf) => T | Promise<T>,
): Promise<T> => {
  const content = await readInput(input);
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  if (HDF5_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return withHdf5(input.name, bytes, visit);
  }
  const cdf = bytes[0] === 0x43 && bytes[1] === 0x44 && bytes[2] === 0x46;
  if (cdf && bytes[3] === 5) {
    throw new Error(`${input.name} is CDF-5, which is not supported.`);
  }
  if (!(cdf && (bytes[3] === 1 || bytes[3] === 2))) {
    throw new Error(`${input.name} is not a netCDF file.`);
  }
  return visit(classicOf(input.name, bytes));
};

/** The number attribute `key`, or `undefined`. */
export const numberAttribute = (attributes: Attributes, key: string) => {
  const value = attributes[key];
  return typeof value === "string" ? undefined : value?.[0];
};

/**
 * `raw` values of `variable` unpacked as CF says: the fill value as NaN,
 * then `scale_factor` and `add_offset` applied.
 */
export const unpack = (
  variable: NetcdfVariable,
  raw: ArrayLike<number>,
): Float64Array => {
  const { attributes } = variable;
  const fill =
    numberAttribute(attributes, "_FillValue") ??
    numberAttribute(attributes, "missing_value");
  const scale = numberAttribute(attributes, "scale_factor") ?? 1;
  const offset = numberAttribute(attributes, "add_offset") ?? 0;
  return Float64Array.from(raw, (v) => (v === fill ? NaN : v * scale + offset));
};
