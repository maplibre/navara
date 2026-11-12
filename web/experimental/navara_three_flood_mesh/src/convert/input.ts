/** A source file to convert: its name, and its contents read on demand. */
export type Input =
  | {
      name: string;
      read: () => Uint8Array | string | Promise<Uint8Array | string>;
    }
  | File;

/** The contents of `input`. */
export const readInput = async (input: Input): Promise<Uint8Array | string> =>
  "read" in input
    ? await input.read()
    : new Uint8Array(await input.arrayBuffer());

/** `bytes` as text: UTF-8, or Shift_JIS where it is not valid UTF-8. */
export const decodeText = (bytes: Uint8Array | string) => {
  if (typeof bytes === "string") return bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
};

/**
 * The fields of a CSV line, split at commas outside quotes, with quoted
 * fields unquoted and doubled quotes undoubled.
 */
export const splitCsvLine = (line: string): string[] => {
  if (!line.includes('"')) return line.split(",");
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      fields.push(field);
      field = "";
    } else field += c;
  }
  fields.push(field);
  return fields;
};

/** A file format the converters read. */
export type Format = "csv" | "netcdf" | "czml";

const FORMATS: Record<string, Format> = {
  csv: "csv",
  txt: "csv",
  nc: "netcdf",
  nc4: "netcdf",
  cdf: "netcdf",
  grd: "netcdf",
  sww: "netcdf",
  czml: "czml",
  json: "czml",
};

/**
 * `format`, or the format the extension of the first of `inputs` names,
 * which must be one of `allowed`.
 */
export const formatOf = <F extends Format>(
  inputs: readonly Input[],
  format: F | undefined,
  allowed: readonly F[],
): F => {
  const name = inputs[0]?.name ?? "";
  const found =
    format ?? FORMATS[/\.([^./]+)$/.exec(name)?.[1].toLowerCase() ?? ""];
  if (!found) {
    throw new Error(`Give the format of ${name}: ${allowed.join(" or ")}.`);
  }
  if (!(allowed as readonly Format[]).includes(found)) {
    throw new Error(
      `The format ${found} is not read here; give ${allowed.join(" or ")}.`,
    );
  }
  return found as F;
};
