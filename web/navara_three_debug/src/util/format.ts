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

/** Milliseconds: two decimals below 10, one above, or `"–"` when unknown. */
export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "–";
  return ms < 10 ? ms.toFixed(2) : ms.toFixed(1);
}

/** `4312566` → `"4.3 M"`, `12500` → `"12.5 k"`. */
export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)} k`;
  return String(Math.round(n));
}

/** The host of a URL, or the text itself when it does not parse. */
export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url, window.location.href).host;
  } catch {
    return url;
  }
}
