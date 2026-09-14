/**
 * Font helper utilities for MapLibre Style plugin.
 */
import { fetchFontFamilyFromCss, type FontFamily } from "@navaramap/three";

/**
 * Fetch a font family from a CSS URL for use with MapLibreStylePlugin.
 * This is a convenience wrapper around fetchFontFamilyFromCss.
 *
 * @param familyName - Font family name to register (e.g., "Open Sans")
 * @param cssUrl - CSS URL to fetch the font from (e.g., Google Fonts URL)
 * @returns FontFamily object ready to pass to MapLibreStylePlugin's fontFamily option
 *
 * @example
 * ```ts
 * const fontFamily = await fetchFontFamilyFromCssForMapLibreStyle(
 *   "Open Sans",
 *   "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap"
 * );
 * const plugin = new MapLibreStylePlugin(style, { fontFamily });
 * ```
 */
export async function fetchFontFamilyFromCssForMapLibreStyle(
  familyName: string,
  cssUrl: string | string[],
): Promise<FontFamily> {
  return fetchFontFamilyFromCss(familyName, cssUrl);
}
