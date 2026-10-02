/**
 * Google Fonts CSS API specs for a full-coverage Noto Sans stack, shared by the
 * examples that label worldwide vector data.
 *
 * These helpers build *strings* only — each example still calls
 * `fetchFontFamilyFromCss` / `view.addFontFamily` itself, so the Navara API
 * stays visible in the example source.
 */

/**
 * Latin face. `wdth` is the width axis of variable Noto Sans: 100 = normal,
 * 87.5 = SemiCondensed, 75 = Condensed.
 */
const latinFace = (weight: number, width: number) =>
  `Noto Sans:wdth,wght@${width},${weight}`;

/**
 * Non-Latin faces covering the scripts worldwide place/road names use, in
 * priority order. `variable: false` marks families Google publishes at a single
 * weight — appending a `wght` axis they don't have makes the whole CSS request
 * fail with HTTP 400, taking every other family down with it.
 *
 * Order matters: for each codepoint the first face whose declared ranges contain
 * it wins, and Google's declared ranges are per-subset boilerplate that can
 * claim codepoints a font doesn't actually contain (which would shape as tofu).
 * This order was verified against the fonts' real coverage:
 * - Bengali/Devanagari/Armenian/Gurmukhi/Syriac precede Noto Sans, which
 *   declares (but lacks) some of their signs, e.g. Vedic marks.
 * - Noto Sans and JP/KR precede the remaining script fonts so shared
 *   symbols/punctuation resolve to fonts that really contain them.
 * - SC and Mongolian go last: Google slices them like CJK fonts whose declared
 *   ranges also claim Hiragana, Hangul, Armenian, Arabic, Thai, Cherokee, and
 *   more that these fonts don't cover.
 */
const SCRIPT_FACES: { family: string; variable?: boolean }[] = [
  { family: "Noto Sans Bengali" },
  { family: "Noto Sans Devanagari" },
  { family: "Noto Sans Armenian" },
  { family: "Noto Sans Gurmukhi" },
  { family: "Noto Sans Arabic" },
  { family: "Noto Sans Syriac" },
  // No plain "Noto Sans" entry: `latinFace` already requests that family with
  // the `wdth` axis pinned. Asking for both merges into one family in the CSS
  // response, emitting the same unicode-ranges at both widths, after which face
  // selection per codepoint is a coin flip between the two.
  { family: "Noto Sans JP" },
  { family: "Noto Sans KR" },
  { family: "Noto Sans Hebrew" },
  { family: "Noto Sans Thaana" },
  { family: "Noto Sans NKo", variable: false },
  { family: "Noto Sans Thai" },
  { family: "Noto Sans Lao" },
  { family: "Noto Sans Khmer" },
  { family: "Noto Sans Myanmar" },
  { family: "Noto Sans Gujarati" },
  { family: "Noto Sans Tamil" },
  { family: "Noto Sans Telugu" },
  { family: "Noto Sans Kannada" },
  { family: "Noto Sans Malayalam" },
  { family: "Noto Sans Oriya" },
  { family: "Noto Sans Sinhala" },
  { family: "Noto Sans Georgian" },
  { family: "Noto Sans Ethiopic" },
  { family: "Noto Serif Tibetan" },
  { family: "Noto Sans Tifinagh", variable: false },
  { family: "Noto Sans Adlam" },
  { family: "Noto Sans Cherokee" },
  { family: "Noto Sans Canadian Aboriginal" },
  { family: "Noto Sans Vai", variable: false },
  { family: "Noto Sans Yi", variable: false },
  { family: "Noto Sans Osmanya", variable: false },
  { family: "Noto Sans SC" },
  { family: "Noto Sans Mongolian", variable: false },
];

/** Google Fonts CSS API specs for one weight, Latin face first. */
export const notoSansStack = (weight: number, width = 100): string[] => [
  latinFace(weight, width),
  ...SCRIPT_FACES.map(({ family, variable }) =>
    variable === false ? family : `${family}:wght@${weight}`,
  ),
];

/** Turns a stack from {@link notoSansStack} into one CSS API request URL. */
export const googleFontsCssUrl = (stack: string[]) =>
  `https://fonts.googleapis.com/css2?${stack
    .map((family) => `family=${family.replace(/ /g, "+")}`)
    .join("&")}`;

/**
 * Credit for the Google Fonts CSS API faces, for `view.attribution.add`.
 */
export const NOTO_SANS_ATTRIBUTION = {
  attribution: "Noto Sans - Google Fonts",
  attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans",
};
