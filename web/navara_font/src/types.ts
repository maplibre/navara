/**
 * Pixel size at which COLRv1 color glyphs are rasterized into the color atlas.
 * Must match `COLOR_GLYPH_PX_SIZE` in `crates/navara_wasm_font_worker/src/color_raster.rs`.
 */
export const COLOR_GLYPH_PX_SIZE = 64.0;

/**
 * Pixel size at which monochrome SDF/MTSDF glyphs are rasterized.
 * Must match `SDF_PX_SIZE` in
 * `crates/navara_wasm_font_worker/src/atlas.rs`.
 */
export const SDF_PX_SIZE = 64.0;

/**
 * Pixel range over which a quality's atlas distance field ramps from
 * "outside" to "inside" (i.e. the value covered by `d - 0.5` in the shader).
 * Converts an outline-thickness expressed in pixels into a delta on the
 * sampled distance value.
 *
 * SDF: `SDF_RADIUS` (35) in `crates/navara_wasm_font_worker/src/atlas.rs`.
 * MSDF: `MSDF_RANGE_PX` (16) in `crates/navara_wasm_font_worker/src/msdf.rs`.
 */
export const atlasRangePx = (highQuality: boolean): number =>
  highQuality ? 16.0 : 35.0;

/**
 * Pixels of distance field a quality's glyph rect keeps around the outline:
 * how far an outline can reach before the glyph quad's edge cuts it off.
 *
 * SDF: `SDF_BUFFER` (12) in `crates/navara_wasm_font_worker/src/atlas.rs`.
 * MSDF: `MSDF_PADDING_PX` (8) in `crates/navara_wasm_font_worker/src/msdf.rs`.
 */
export const atlasPaddingPx = (highQuality: boolean): number =>
  highQuality ? 8.0 : 12.0;

/** Glyph metrics from either the SDF or the color atlas. */
export type GlyphMetrics = {
  glyphId: number;
  /** Unique font index within the atlas (distinguishes glyphs from different fonts). */
  fontIndex: number;
  /** Pre-computed composite key (font_index, glyph_id) from WASM. */
  compositeKey: bigint;
  atlasX: number;
  atlasY: number;
  atlasW: number;
  atlasH: number;
  bearingX: number;
  bearingY: number;
  /** True when this glyph lives in the COLRv1 color atlas (RGBA) rather than the SDF atlas (R8). */
  isColor: boolean;
};

/**
 * Per-glyph character class used for line breaking during layout.
 * Must match the `CHAR_CLASS_*` constants in
 * `crates/navara_wasm_font_worker/src/shaping.rs`.
 */
export const GlyphCharClass = {
  Normal: 0,
  /** Breakable whitespace: a line may wrap here, dropping the glyph. */
  Whitespace: 1,
  /** Synthetic hard-break marker (zero advance, no atlas entry). */
  Newline: 2,
  /** CJK-style character: a line may break after this glyph. */
  Ideographic: 3,
} as const;

/**
 * Direction of the `\n`-separated segment a glyph was shaped in. Must match
 * the `DIRECTION_*` constants in
 * `crates/navara_wasm_font_worker/src/shaping.rs`.
 */
export const GlyphDirection = {
  /** No character with a script of its own (digits, punctuation, spaces).
   *  Font-family fallback shapes such runs apart from the letters around
   *  them, so a line's direction is its first non-neutral glyph's. */
  Neutral: 0,
  Ltr: 1,
  /** The segment's glyphs arrive in visual order (reversed logical order). */
  Rtl: 2,
} as const;

/** A single shaped glyph with positioning info. */
export type ShapedGlyph = {
  glyphId: number;
  /** Unique font index within the atlas (distinguishes glyphs from different fonts). */
  fontIndex: number;
  /** Pre-computed composite key (font_index, glyph_id) from WASM. */
  compositeKey: bigint;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  /** One of `GlyphCharClass` (line-break info). */
  charClass: number;
  /** Same shaping cluster as the previous glyph (combining marks, pre-base
   *  vowels). Letter spacing is inserted only before cluster starts. */
  continuesCluster?: boolean;
  /** One of `GlyphDirection`; absent means neutral. */
  direction?: number;
};

/** Result from shaping text: glyph positions + atlas metrics. */
export type ShapeTextResult = {
  glyphs: ShapedGlyph[];
  metrics: GlyphMetrics[];
  /** Font units per em (needed for converting font-unit to pixel space) */
  unitsPerEm: number;
  /** Ascender in font units (hhea), for multi-line layout. */
  ascender: number;
  /** Descender in font units (hhea, negative below baseline). */
  descender: number;
  /** Extra line gap in font units (hhea). */
  lineGap: number;
  /** False when letter spacing must not be applied: tracking pulls apart the
   *  joined letterforms of cursive Arabic, so (like MapLibre) any Arabic
   *  character disables it for the whole label. */
  allowsLetterSpacing: boolean;
  /** FontManager-internal: the atlas generation these metrics were built
   *  under. When the atlas evicts glyphs its generation bumps, marking older
   *  cached results stale so they are re-shaped on next use. Unset on results
   *  fresh from the worker; the FontManager stamps it when caching. */
  _generation?: number;
};

/** SDF/MSDF atlas texture data.
 *
 * `channels` selects the GPU texture format:
 *  - 1 → R8 (single-channel SDF, sampled as `.r`).
 *  - 4 → RGBA8. Either MTSDF (three MSDF channels + true SDF in alpha,
 *    sampled as `median(.rgb)` in the fragment shader) or the COLRv1 color
 *    atlas — distinguished by which atlas slot the data was placed in, not
 *    by `channels`.
 *
 * 3-channel MSDF (RGB8) isn't used: three.js dropped `RGBFormat` in r137,
 * and the worker emits MTSDF (4 channels) for the high-quality path.
 */
export type FontAtlasData = {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
};

export type BatchPrepareTextResult = {
  results: { text: string; shapeResult: ShapeTextResult | null }[];
  /** Snapshot of the SDF atlas, if any glyphs were added during the batch. */
  atlas: FontAtlasData | null;
  /** Snapshot of the COLRv1 color atlas (RGBA), if any color glyphs were added during the batch. */
  colorAtlas: FontAtlasData | null;
  /** The atlas key used for this batch (family name or font URL). */
  atlasKey: string;
  /** True if any glyph was evicted during this batch. The reused rects mean
   *  cached shape results for this atlas may be stale, so the FontManager bumps
   *  the atlas generation to force a re-shape on next use. Optional only so
   *  callers needn't construct it (the worker always sends it). */
  evicted?: boolean;
};

/** Snapshot of the font worker's WASM heap and font-cache memory usage. */
export type FontWorkerMemoryStats = {
  /** Total WASM linear memory of the font worker (never shrinks). */
  heapBytes: number;
  fontCount: number;
  atlasCount: number;
  glyphCount: number;
  /** Raw font file bytes held by the cache. */
  fontBytes: number;
  /** Monochrome (SDF/MSDF) atlas pixel bytes. */
  atlasBytes: number;
  /** COLRv1 color atlas pixel bytes. */
  colorAtlasBytes: number;
  /** Configured cache budget; undefined when unlimited. */
  budgetBytes?: number;
};

/** Inclusive codepoint range covered by a font face. */
export type UnicodeRange = {
  from: number;
  to: number;
};

export type FontFace = {
  unicodeRanges: UnicodeRange[];
  url: string;
};

export type FontFamily = {
  family: string;
  faces: FontFace[];
};
