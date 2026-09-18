/**
 * Font helper utilities for MapLibre Style plugin.
 */
import type {
  StyleSpecification,
  FontFacesSpecification,
  MLFontFace,
} from "@maplibre/maplibre-gl-style-spec";
import { fetchFontFamilyFromCss, type FontFamily } from "@navaramap/three";

/**
 * Convert unicode range from Navara format to MapLibre format.
 * Navara: { from: number, to: number }
 * MapLibre: "U+from-to" (hex format)
 */
function unicodeRangeToString(range: { from: number; to: number }): string {
  const fromHex = range.from.toString(16).toUpperCase();
  const toHex = range.to.toString(16).toUpperCase();
  return `U+${fromHex}-${toHex}`;
}

/**
 * Normalize unicode-range input to string array.
 * Handles both single string and array inputs.
 *
 * @param input - unicode-range value (string | string[] | unknown)
 * @param fontFamily - Font family name (for logging warnings)
 * @returns Normalized string array, or empty array if invalid
 */
export function normalizeUnicodeRange(
  input: unknown,
  fontFamily: string,
): string[] {
  if (typeof input === "string") {
    return [input];
  }
  if (Array.isArray(input)) {
    // Validate each entry is a string
    const valid = input.filter((item) => {
      if (typeof item !== "string") {
        console.warn(
          `[fontHelper] Invalid unicode-range entry for font "${fontFamily}": expected string, got ${typeof item}. Skipping.`,
        );
        return false;
      }
      return true;
    });
    return valid;
  }
  // Invalid type
  console.warn(
    `[fontHelper] Invalid unicode-range for font "${fontFamily}": expected string or string[], got ${typeof input}. Skipping.`,
  );
  return [];
}

/**
 * Parse unicode-range string(s) into Navara format.
 * Supports multiple formats:
 * - Single codepoint: "U+26" -> {from: 0x26, to: 0x26}
 * - Range: "U+0-7F" -> {from: 0, to: 127}
 * - Comma-separated: "U+0-7F, U+100-17F" -> multiple ranges
 *
 * @param rangeStrings - Array of unicode-range strings from MapLibre style
 * @param fontFamily - Font family name (for logging warnings)
 * @returns Array of parsed unicode ranges
 */
export function parseUnicodeRanges(
  rangeStrings: string[],
  fontFamily: string,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];

  for (const rangeStr of rangeStrings) {
    // Split by comma to handle comma-separated lists
    const parts = rangeStr.split(",").map((s) => s.trim());

    for (const part of parts) {
      if (!part) continue;

      // Try to match range format: U+XXXX-YYYY
      const rangeMatch = part.match(/^U\+([0-9A-Fa-f]+)-([0-9A-Fa-f]+)$/);
      if (rangeMatch) {
        const from = Number.parseInt(rangeMatch[1], 16);
        const to = Number.parseInt(rangeMatch[2], 16);

        // Validate parsed values
        if (Number.isNaN(from) || Number.isNaN(to)) {
          console.warn(
            `[fontHelper] Invalid unicode-range "${part}" for font "${fontFamily}": parsing failed. Skipping.`,
          );
          continue;
        }
        if (from > to) {
          console.warn(
            `[fontHelper] Invalid unicode-range "${part}" for font "${fontFamily}": from (${from.toString(16)}) > to (${to.toString(16)}). Skipping.`,
          );
          continue;
        }
        if (from < 0 || to > 0x10ffff) {
          console.warn(
            `[fontHelper] Invalid unicode-range "${part}" for font "${fontFamily}": out of Unicode bounds (0-10FFFF). Skipping.`,
          );
          continue;
        }

        ranges.push({ from, to });
        continue;
      }

      // Try to match single codepoint: U+XXXX
      const singleMatch = part.match(/^U\+([0-9A-Fa-f]+)$/);
      if (singleMatch) {
        const codepoint = Number.parseInt(singleMatch[1], 16);

        // Validate parsed value
        if (Number.isNaN(codepoint)) {
          console.warn(
            `[fontHelper] Invalid unicode-range "${part}" for font "${fontFamily}": parsing failed. Skipping.`,
          );
          continue;
        }
        if (codepoint < 0 || codepoint > 0x10ffff) {
          console.warn(
            `[fontHelper] Invalid unicode-range "${part}" for font "${fontFamily}": out of Unicode bounds (0-10FFFF). Skipping.`,
          );
          continue;
        }

        ranges.push({ from: codepoint, to: codepoint });
        continue;
      }

      // Unparseable format - warn
      console.warn(
        `[fontHelper] Unparseable unicode-range "${part}" for font "${fontFamily}". ` +
          `Supported formats: "U+26" (single codepoint), "U+0-7F" (range), "U+0-7F, U+100-17F" (comma-separated).`,
      );
    }
  }

  return ranges;
}

/**
 * Convert MapLibre Style font-faces to Navara FontFamily objects.
 * This is the inverse of fontFamilyToStyleOverrides.
 *
 * @param fontFaces - FontFacesSpecification from MapLibre style
 * @returns Array of FontFamily objects ready to register with view
 *
 * @example
 * ```ts
 * const fontFamilies = convertFontFacesToFontFamilies(style["font-faces"]);
 * for (const family of fontFamilies) {
 *   view.addFontFamily(family);
 * }
 * ```
 */
export function convertFontFacesToFontFamilies(
  fontFaces: FontFacesSpecification,
): FontFamily[] {
  const fontFamilies: FontFamily[] = [];

  for (const [familyName, faceSpec] of Object.entries(fontFaces)) {
    const fontFamily: FontFamily = {
      family: familyName,
      faces: [],
    };

    if (typeof faceSpec === "string") {
      // Simple URL format
      fontFamily.faces.push({
        url: faceSpec,
        unicodeRanges: [],
      });
    } else if (Array.isArray(faceSpec)) {
      // Array of font face objects (multiple faces per family)
      for (const face of faceSpec) {
        if (!face.url || typeof face.url !== "string") {
          console.warn(
            `[fontHelper] Invalid font face for "${familyName}": missing or invalid url. Skipping.`,
          );
          continue;
        }

        const normalized = normalizeUnicodeRange(
          face["unicode-range"],
          familyName,
        );
        const unicodeRanges =
          normalized.length > 0
            ? parseUnicodeRanges(normalized, familyName)
            : [];

        fontFamily.faces.push({
          url: face.url,
          unicodeRanges,
        });
      }
    } else {
      // Single object format with url and optional unicode-range
      // Validate that faceSpec is an object before accessing properties
      if (!faceSpec || typeof faceSpec !== "object") {
        console.warn(
          `[fontHelper] Invalid font face for "${familyName}": expected object, got ${typeof faceSpec}. Skipping.`,
        );
        continue;
      }

      if (!faceSpec.url || typeof faceSpec.url !== "string") {
        console.warn(
          `[fontHelper] Invalid font face for "${familyName}": missing or invalid url. Skipping.`,
        );
        continue;
      }

      const normalized = normalizeUnicodeRange(
        faceSpec["unicode-range"],
        familyName,
      );
      const unicodeRanges =
        normalized.length > 0 ? parseUnicodeRanges(normalized, familyName) : [];

      fontFamily.faces.push({
        url: faceSpec.url,
        unicodeRanges,
      });
    }

    if (fontFamily.faces.length > 0) {
      fontFamilies.push(fontFamily);
    }
  }

  return fontFamilies;
}

/**
 * Convert Navara FontFamily to MapLibre Style font-faces format.
 * This uses the standard MapLibre `font-faces` field.
 *
 * MapLibre supports multiple font files per family (for different unicode ranges),
 * which maps perfectly to Navara's FontFamily.faces array.
 *
 * @param fontFamilies - One or more FontFamily objects to include in the style
 * @returns StyleSpecification overrides with font-faces
 *
 * @example
 * ```ts
 * const fontFamily = await fetchFontFamilyFromCss(
 *   "Open Sans",
 *   "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap"
 * );
 * const plugin = new MapLibreStylePlugin(
 *   style,
 *   fontFamilyToStyleOverrides(fontFamily)
 * );
 * ```
 */
export function fontFamilyToStyleOverrides(
  ...fontFamilies: FontFamily[]
): Partial<StyleSpecification> {
  const fontFaces: FontFacesSpecification = {};

  for (const family of fontFamilies) {
    if (family.faces.length === 0) {
      console.warn(`FontFamily "${family.family}" has no faces, skipping.`);
      continue;
    }

    if (
      family.faces.length === 1 &&
      family.faces[0].unicodeRanges.length === 0
    ) {
      // Single face without unicode ranges: use simplified string format
      fontFaces[family.family] = family.faces[0].url;
    } else {
      // Multiple faces: use array format
      const faceArray = family.faces.map((face) => {
        const faceObj: { url: string; "unicode-range"?: string[] } = {
          url: face.url,
        };
        if (face.unicodeRanges.length > 0) {
          faceObj["unicode-range"] =
            face.unicodeRanges.map(unicodeRangeToString);
        }
        return faceObj;
      });

      fontFaces[family.family] = faceArray as unknown as MLFontFace;
    }
  }

  return {
    "font-faces": fontFaces,
  };
}

/**
 * Fetch a font family from a CSS URL and convert to MapLibre Style overrides.
 * This is a convenience function that combines fetchFontFamilyFromCss and fontFamilyToStyleOverrides.
 *
 * @param familyName - Font family name to register (e.g., "Open Sans")
 * @param cssUrl - CSS URL to fetch the font from (e.g., Google Fonts URL)
 * @returns StyleSpecification overrides with font metadata
 *
 * @example
 * ```ts
 * const overrides = await fetchFontStyleOverrides(
 *   "Open Sans",
 *   "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap"
 * );
 * const plugin = new MapLibreStylePlugin(style, overrides);
 * ```
 */
export async function fetchFontStyleOverrides(
  familyName: string,
  cssUrl: string | string[],
): Promise<Partial<StyleSpecification>> {
  const fontFamily = await fetchFontFamilyFromCss(familyName, cssUrl);
  return fontFamilyToStyleOverrides(fontFamily);
}
