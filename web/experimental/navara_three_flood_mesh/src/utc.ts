/**
 * Milliseconds since the Unix epoch of a date or date-time, read as UTC when
 * it names no zone, where `Date.parse` would take a date-time as local time;
 * `NaN` when it is neither.
 */
export const parseUtc = (value: string): number => {
  const match =
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      value.trim(),
    );
  if (!match) return Date.parse(value);
  const [, year, month, day, time = "00:00", zone = "Z"] = match;
  const pad = (s: string) => s.padStart(2, "0");
  const [hour, rest] = time.split(/:(.*)/);
  return Date.parse(
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${rest}${zone.toUpperCase()}`,
  );
};
