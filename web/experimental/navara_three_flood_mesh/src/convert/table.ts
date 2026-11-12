/**
 * What the CSV readers (`readRastersCsv`, `readMeshCsv`) share: reading a
 * table, timing its rows, and storing the ground height.
 */
import { parseUtc } from "../utc";

import { decodeText, readInput, splitCsvLine, type Input } from "./input";
import { thinTimes } from "./time";

const SECONDS_PER_UNIT = { seconds: 1, minutes: 60, hours: 3600 };
/** The property the ground height is stored as, when a converter is given it. */
export const GROUND_PROPERTY = "ground";
const GROUND_PRECISION = 0.01;
const GROUND_LABEL = "ground height above the WGS84 ellipsoid";

/** The columns of a position: longitude and latitude, or easting and northing. */
export type CoordinateColumns = [string, string];

export type TimeOptions = {
  /**
   * Column holding the time, or `timePattern`, whose first group picks it out
   * of each file name. A number counts `timeUnit`s since `epoch`; any other
   * value is parsed as a date, in UTC when it names no time zone. A
   * `timeUnit` may also be given as the seconds it lasts, such as `0.02`
   * for model steps of 0.02 s.
   */
  time?: string;
  timePattern?: RegExp;
  timeUnit?: keyof typeof SECONDS_PER_UNIT | number;
  epoch?: Date;
};

/** A field as a number: `NaN` when it is empty, which `Number` reads as 0. */
export const numberOf = (field: string | undefined): number =>
  field?.trim() ? Number(field) : NaN;

/** Reads times as seconds since the Unix epoch, from fields or file names. */
export const timeReader = ({
  time,
  timePattern,
  timeUnit = "seconds",
  epoch,
}: TimeOptions) => {
  if (!time === !timePattern) {
    throw new Error("Give either time or timePattern.");
  }
  const secondsOf = (value: string) => {
    const number = numberOf(value);
    if (Number.isFinite(number)) {
      if (!epoch) throw new Error("A numeric time needs an epoch.");
      const unit =
        typeof timeUnit === "number" ? timeUnit : SECONDS_PER_UNIT[timeUnit];
      return epoch.getTime() / 1000 + number * unit;
    }
    const date = parseUtc(value);
    if (Number.isNaN(date)) throw new Error(`Not a time: ${value}`);
    return date / 1000;
  };
  const timeOfFile = (input: Input) => {
    const match = timePattern?.exec(input.name);
    if (!match?.[1]) throw new Error(`The time pattern misses ${input.name}.`);
    return secondsOf(match[1]);
  };
  return {
    secondsOf,
    /** The time of a file named by it, or `undefined` for a time column. */
    fileTime: (input: Input) => (timePattern ? timeOfFile(input) : undefined),
    /** The inputs to read: with a time pattern, those `interval` keeps. */
    kept: (inputs: Input[], interval: number) => {
      if (!timePattern) return inputs;
      const times = [...new Set(inputs.map(timeOfFile))].sort((a, b) => a - b);
      const kept = new Set(thinTimes(times, interval).map((k) => times[k]));
      return inputs.filter((input) => kept.has(timeOfFile(input)));
    },
  };
};

export type Table = {
  name: string;
  header: string[];
  /** The index of `column` in the header, or -1. */
  index: (column: string) => number;
  /** The rows after the header with their line numbers, blank lines skipped. */
  rows: () => Generator<{ fields: string[]; line: number }>;
};

/**
 * The CSV table of `input`, whose header is its first line naming every
 * column in `wanted`; lines before it are skipped. UTF-8 and Shift_JIS are
 * recognized. A field may be quoted, but not span lines.
 */
export const readTable = async (
  input: Input,
  wanted: string[],
): Promise<Table> => {
  const lines = decodeText(await readInput(input)).split(/\r?\n/);
  const headerLine = lines.findIndex((line) => {
    const fields = splitCsvLine(line).map((f) => f.trim());
    return wanted.every((c) => fields.includes(c));
  });
  if (headerLine === -1) {
    throw new Error(`${input.name} has no header naming ${wanted.join(", ")}.`);
  }
  const header = splitCsvLine(lines[headerLine]).map((f) => f.trim());
  return {
    name: input.name,
    header,
    index: (column) => header.indexOf(column),
    *rows() {
      for (let l = headerLine + 1; l < lines.length; l++) {
        if (lines[l].trim())
          yield { fields: splitCsvLine(lines[l]), line: l + 1 };
      }
    },
  };
};

/** A row keyed by column, with the fields trimmed, for property callbacks. */
export const recordOf = (header: string[], fields: string[]) =>
  Object.fromEntries(
    header.map((column, i) => [column, (fields[i] ?? "").trim()]),
  );

/**
 * The precisions, units and labels to write with the ground height stored as
 * `GROUND_PROPERTY`, unless the properties already hold one of that name.
 */
export const groundStorage = (
  ground: string | undefined,
  written: string[],
  {
    precision,
    units,
    labels,
  }: {
    precision?: Record<string, number>;
    units?: Record<string, string>;
    labels?: Record<string, string>;
  },
) => {
  const stores = !!ground && !written.includes(GROUND_PROPERTY);
  return {
    stores,
    attributes: stores ? { ground: GROUND_PROPERTY } : {},
    precision: stores
      ? { [GROUND_PROPERTY]: GROUND_PRECISION, ...precision }
      : precision,
    units: stores ? { [GROUND_PROPERTY]: "m", ...units } : units,
    labels: stores ? { [GROUND_PROPERTY]: GROUND_LABEL, ...labels } : labels,
  };
};
