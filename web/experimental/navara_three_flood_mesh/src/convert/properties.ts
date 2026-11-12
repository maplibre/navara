/**
 * Numeric properties carried from the source records (CSV rows, CZML
 * packets) into the Zarr group, one `[time, lat, lon]` array each.
 */

/**
 * Derives the properties to store from a record's own, such as a CZML
 * packet's `properties` or a CSV row keyed by column. Values that are not
 * finite numbers are dropped with a warning.
 */
export type PropertiesCallback = <P extends Record<string, unknown>>(
  properties: P,
) => Record<string, unknown>;

/**
 * The properties to store: names of the record's own to take as they are,
 * or a callback deriving them.
 */
export type PropertiesOption = string[] | PropertiesCallback;

type Dropped = { count: number; example: unknown };

/**
 * Collects the numeric properties of records, keeping count of what it had
 * to drop so `report` can warn once per property.
 */
export class PropertyCollector {
  readonly names: string[] = [];
  private readonly dropped = new Map<string, Dropped>();
  private readonly kept = new Map<string, number>();

  constructor(
    private readonly option: PropertiesOption,
    /** Strings parse as numbers, for sources without types such as CSV. */
    private readonly parseStrings = false,
  ) {
    if (Array.isArray(option)) this.names.push(...option);
  }

  /** The numeric properties of one record; a dropped value is NaN. */
  collect(properties: Record<string, unknown>): Record<string, number> {
    const raw = Array.isArray(this.option)
      ? Object.fromEntries(this.option.map((n) => [n, properties[n]]))
      : this.option(properties);
    const out: Record<string, number> = {};
    for (const [name, value] of Object.entries(raw)) {
      if (!this.names.includes(name)) this.names.push(name);
      const number = this.numberOf(value);
      if (Number.isFinite(number)) {
        out[name] = number;
        this.kept.set(name, (this.kept.get(name) ?? 0) + 1);
      } else {
        out[name] = NaN;
        // An absent value is missing, not malformed.
        if (value === undefined || value === null || value === "") continue;
        const dropped = this.dropped.get(name);
        if (dropped) dropped.count++;
        else this.dropped.set(name, { count: 1, example: value });
      }
    }
    return out;
  }

  /** The names with at least one numeric value. */
  get written(): string[] {
    return this.names.filter((n) => this.kept.has(n));
  }

  /** Warns about the dropped values and the properties left unwritten. */
  report(warn: (message: string) => void = console.warn): void {
    for (const [name, { count, example }] of this.dropped) {
      warn(
        `Property "${name}": ${count} value(s) are not numbers, such as ` +
          `${JSON.stringify(example)}; they are treated as missing.`,
      );
    }
    for (const name of this.names) {
      if (!this.kept.has(name)) {
        warn(`Property "${name}" has no numeric value and is not written.`);
      }
    }
  }

  private numberOf(value: unknown): number {
    if (typeof value === "number") return value;
    if (this.parseStrings && typeof value === "string" && value.trim()) {
      return Number(value);
    }
    return NaN;
  }
}

/**
 * A CZML packet's `properties` with the constant forms unwrapped:
 * `{ number: 3 }` reads as `3`; sampled values are left as they are.
 */
export const unwrapCzmlProperties = (
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(properties ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const constant = value as Record<string, unknown>;
      out[name] =
        constant.number ?? constant.string ?? constant.boolean ?? value;
    } else {
      out[name] = value;
    }
  }
  return out;
};
