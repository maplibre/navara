const UNITS = ["B", "KB", "MB", "GB"];

/** `1536` → `"1.5 KB"`. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${UNITS[unit]}`;
}

/** Milliseconds with two decimals, or `"-"` when unknown. */
export function formatMs(ms: number | undefined): string {
  return ms === undefined ? "-" : ms.toFixed(2);
}

/** Right-aligns `value` in a field of `width` characters. */
export function padLeft(value: string | number, width: number): string {
  return String(value).padStart(width);
}

/** Left-aligns `value` in a field of `width` characters, truncating. */
export function padRight(value: string, width: number): string {
  return value.length > width
    ? value.slice(0, width - 1) + "…"
    : value.padEnd(width);
}
