import initApi, {
  parseCssUnicodeRange as wasmParseCssUnicodeRange,
  parseFontFamilyFromCss as wasmParseFontFamilyFromCss,
} from "@navaramap/engine-api";

import type { FontFamily, UnicodeRange } from "./types";

/** Filters selecting which `@font-face` blocks of a stylesheet to include. */
export type CssFontFaceFilter = {
  /**
   * Only include blocks whose `font-family` matches one of these names
   * (quotes stripped, case-insensitive). Useful when a stylesheet declares
   * several families and only some should become faces.
   *
   * When given as an array, it also sets face priority: faces are ordered by
   * their family's position in the array (stable within a family). This
   * matters for stylesheets like the Google Fonts CSS API that sort
   * `@font-face` blocks alphabetically regardless of request order — face
   * order decides which face wins for codepoints covered by several faces,
   * and `faces[0]` is the fallback for uncovered codepoints.
   */
  fontFamily?: string | string[];
  /** Only include blocks whose `font-weight` matches, e.g. `800` or `"100 900"`. */
  fontWeight?: string | number;
  /** Only include blocks whose `font-style` matches, e.g. `"normal"` or `"italic"`. */
  fontStyle?: string;
};

export type ParseCssFontFamilyOptions = CssFontFaceFilter & {
  /** Base URL used to resolve relative `src: url(...)` references. */
  baseUrl?: string;
};

export type FetchCssFontFamilyOptions = CssFontFaceFilter & {
  /** Extra `fetch` options (e.g. credentials for a private font host). */
  requestInit?: RequestInit;
};

// The @font-face / unicode-range parsing lives in Rust (`navara_wasm_api`,
// published as `@navaramap/engine-api`); these functions are thin wrappers that
// initialize that WASM module and delegate. Parsing correctness is covered by
// the crate's Rust tests; the TS tests here cover the fetch orchestration.
//
// The WASM module is instantiated lazily and at most once — the promise is
// memoized so concurrent callers share a single init (`__wbg_init` itself is
// idempotent once resolved, but memoizing avoids a redundant instantiate while
// the first is still in flight).
let apiReady: Promise<unknown> | undefined;
function ensureApi(): Promise<unknown> {
  return (apiReady ??= initApi());
}

/**
 * Parse a CSS `unicode-range` descriptor value (e.g. `"U+0-7F, U+131, U+4??"`)
 * into inclusive codepoint ranges. Supports single codepoints (`U+26`),
 * intervals (`U+0102-0103`) and wildcards (`U+4??`).
 *
 * Backed by WASM, so it resolves once `@navaramap/engine-api` has initialized.
 */
export async function parseCssUnicodeRange(
  value: string,
): Promise<UnicodeRange[]> {
  await ensureApi();
  return wasmParseCssUnicodeRange(value) as UnicodeRange[];
}

/**
 * Build a {@link FontFamily} from CSS `@font-face` rules, so faces and their
 * unicode ranges don't have to be written by hand. Each `@font-face` block
 * becomes one face: its `src` URL and its `unicode-range` (faces stay
 * lazily downloaded — a face is only fetched once text actually needs a
 * codepoint in its ranges). Blocks without a `unicode-range` cover all
 * codepoints.
 *
 * Face priority follows CSS semantics: later `@font-face` rules take
 * precedence when their unicode-ranges overlap, so faces come out in
 * reverse stylesheet order (use the `fontFamily` array to order families
 * explicitly). The resulting first face doubles as the fallback for
 * codepoints no face covers — same semantics as a hand-written
 * {@link FontFamily}.
 *
 * The parsing runs in WASM (`@navaramap/engine-api`), so this resolves once
 * that module has initialized.
 *
 * @param family Family name to register the faces under.
 * @param cssText Stylesheet text containing `@font-face` rules.
 * @param options Optional block filters and a `baseUrl` for relative URLs.
 */
export async function parseFontFamilyFromCss(
  family: string,
  cssText: string,
  options: ParseCssFontFamilyOptions = {},
): Promise<FontFamily> {
  await ensureApi();
  return wasmParseFontFamilyFromCss(family, cssText, options) as FontFamily;
}

/**
 * Fetch one or more stylesheets and build a {@link FontFamily} from their
 * `@font-face` rules — see {@link parseFontFamilyFromCss}. Only the CSS is
 * downloaded here; font files stay lazily fetched per face as text needs
 * them.
 *
 * Works directly with the Google Fonts CSS API, which declares one
 * `@font-face` per script subset with `unicode-range` (CJK families are
 * split into ~100 lazily-loaded slices):
 *
 * ```ts
 * const family = await fetchFontFamilyFromCss(
 *   "labels",
 *   "https://fonts.googleapis.com/css2?family=Archivo:wght@800&family=Noto+Sans+JP:wght@800",
 * );
 * view.addFontFamily(family);
 * ```
 *
 * When passing multiple URLs, face priority follows URL order, then block
 * order within each stylesheet.
 *
 * @param family Family name to register the faces under.
 * @param cssUrl Stylesheet URL(s) to fetch.
 * @param options Optional block filters and fetch options.
 */
export async function fetchFontFamilyFromCss(
  family: string,
  cssUrl: string | string[],
  options: FetchCssFontFamilyOptions = {},
): Promise<FontFamily> {
  const urls = Array.isArray(cssUrl) ? cssUrl : [cssUrl];
  const { requestInit, ...filter } = options;
  const faces: FontFamily["faces"] = [];
  const cssTexts = await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url, requestInit);
      if (!response.ok) {
        throw new Error(
          `fetchFontFamilyFromCss: failed to fetch "${url}" (${response.status})`,
        );
      }
      // response.url follows redirects, making it the right base for
      // relative src URLs.
      return { text: await response.text(), baseUrl: response.url || url };
    }),
  );
  for (const { text, baseUrl } of cssTexts) {
    const parsed = await parseFontFamilyFromCss(family, text, {
      ...filter,
      baseUrl,
    });
    faces.push(...parsed.faces);
  }
  return { family, faces };
}
