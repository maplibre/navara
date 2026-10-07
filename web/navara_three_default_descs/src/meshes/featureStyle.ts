/**
 * Resolved `clampToGround`; unset means clamped. The geometry builder and the
 * material must both read it from here.
 */
export function isClampedToGround(style: { clampToGround?: boolean }): boolean {
  return style.clampToGround ?? true;
}

/**
 * The style as the geometry builder reads it: `omit` keys dropped, colours
 * resolved to hex and `clampToGround` resolved.
 *
 * Colours are detected by their `toHex` method, so a `Color` from another
 * copy of the package resolves too.
 */
export function toGeometryMaterial<T>(
  style: { clampToGround?: boolean },
  omit: readonly string[],
): T {
  const raw: Record<string, unknown> = {};
  for (const entry of Object.entries(style)) {
    if (omit.includes(entry[0])) continue;
    const value: unknown = entry[1];
    raw[entry[0]] =
      typeof value === "object" && value !== null && "toHex" in value
        ? (value as { toHex(): number }).toHex()
        : value;
  }
  raw.clampToGround = isClampedToGround(style);
  return raw as T;
}
