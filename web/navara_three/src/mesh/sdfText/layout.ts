import {
  COLOR_GLYPH_PX_SIZE,
  GlyphCharClass,
  GlyphDirection,
  SDF_PX_SIZE,
  type GlyphMetrics,
  type ShapedGlyph,
  type ShapeTextResult,
} from "@navaramap/font";

/**
 * Pure text-layout helpers: line breaking and turning a
 * shaping result into positioned glyph quads in em space.
 *
 * Nothing here touches three.js or WASM, which is what makes the layout rules
 * — the part with all the edge cases — unit-testable without a GL context.
 */

/** Horizontal alignment of lines within a multi-line block, as the fraction
 *  of leftover width placed before each line. */
export const ALIGN_FACTORS: Record<string, number> = {
  left: 0,
  center: 0.5,
  right: 1,
};

/**
 * Letter spacing (font units) between two adjacent glyphs of a line: only at
 * shaping-cluster boundaries, so marks stay on their base, and never before a
 * line's first glyph (`prev` undefined) — trailing spacing can't arise either.
 *
 * `continuesCluster` refers to the shaper's (visual) order; when walking a
 * reversed run (RTL wrapped in logical order) the flag that separates the
 * pair sits on `prev` instead of `next`.
 */
function spacingBetween(
  prev: ShapedGlyph | undefined,
  next: ShapedGlyph,
  spacingFu: number,
  reversed = false,
): number {
  if (!prev || spacingFu === 0) return 0;
  return (reversed ? prev : next).continuesCluster ? 0 : spacingFu;
}

/** Line width in font units: advances (plus letter spacing between clusters)
 *  summed, trailing whitespace ignored so it never affects alignment or the
 *  block width. */
export function lineWidthFu(line: ShapedGlyph[], spacingFu = 0): number {
  let end = line.length;
  while (end > 0 && line[end - 1].charClass === GlyphCharClass.Whitespace) {
    end--;
  }
  let width = 0;
  for (let i = 0; i < end; i++) {
    width += spacingBetween(line[i - 1], line[i], spacingFu) + line[i].xAdvance;
  }
  return width;
}

/**
 * Split a shaped glyph run into lines: hard breaks at newline markers, greedy
 * soft breaks at the last whitespace/ideographic glyph when a line would
 * exceed `maxWidthFu` (font units; 0 disables wrapping). A word longer than
 * the wrap width overflows rather than breaking mid-word. `spacingFu` is the
 * letter spacing between clusters, counted toward the wrap width.
 *
 * A hard-break segment whose first non-neutral glyph was shaped right-to-left
 * (see `GlyphDirection`) arrives in visual order (leftmost first), i.e.
 * reversed logical order. It is wrapped in logical order so the greedy fill starts at the sentence start and lines
 * stack top-to-bottom in reading order, then every line is flipped back to
 * visual order for rendering. Mixed-direction lines may still break
 * sub-optimally — same trade other map renderers make.
 */
export function breakLines(
  glyphs: ShapedGlyph[],
  maxWidthFu: number,
  spacingFu = 0,
): ShapedGlyph[][] {
  const lines: ShapedGlyph[][] = [];

  const pushSegment = (segment: ShapedGlyph[]) => {
    const strong = segment.find(
      (g) => (g.direction ?? GlyphDirection.Neutral) !== GlyphDirection.Neutral,
    );
    if (strong?.direction !== GlyphDirection.Rtl) {
      lines.push(...wrapSegment(segment, maxWidthFu, spacingFu, false));
      return;
    }
    segment.reverse();
    for (const line of wrapSegment(segment, maxWidthFu, spacingFu, true)) {
      lines.push(line.reverse());
    }
  };

  let segment: ShapedGlyph[] = [];
  for (const g of glyphs) {
    if (g.charClass === GlyphCharClass.Newline) {
      pushSegment(segment);
      segment = [];
    } else {
      segment.push(g);
    }
  }
  pushSegment(segment);
  return lines;
}

/** Greedy soft-wrap of a single hard-break-free segment in logical order.
 *  `reversed` marks a run flipped out of the shaper's visual order (RTL). */
function wrapSegment(
  glyphs: ShapedGlyph[],
  maxWidthFu: number,
  spacingFu: number,
  reversed: boolean,
): ShapedGlyph[][] {
  const lines: ShapedGlyph[][] = [];
  let line: ShapedGlyph[] = [];
  let width = 0;
  let breakIdx = -1; // index in `line` of the last break opportunity

  for (const g of glyphs) {
    // Trailing whitespace is invisible at a line end, so it never triggers a
    // wrap itself — it just gets trimmed if a later glyph wraps.
    if (
      maxWidthFu > 0 &&
      g.charClass !== GlyphCharClass.Whitespace &&
      line.length > 0 &&
      breakIdx >= 0 &&
      width +
        spacingBetween(line[line.length - 1], g, spacingFu, reversed) +
        g.xAdvance >
        maxWidthFu
    ) {
      const head = line.slice(0, breakIdx + 1);
      while (
        head.length > 0 &&
        head[head.length - 1].charClass === GlyphCharClass.Whitespace
      ) {
        head.pop();
      }
      lines.push(head);

      const tail = line.slice(breakIdx + 1);
      const start = tail.findIndex(
        (gg) => gg.charClass !== GlyphCharClass.Whitespace,
      );
      line = start === -1 ? [] : tail.slice(start);

      width = 0;
      for (let i = 0; i < line.length; i++) {
        width +=
          spacingBetween(line[i - 1], line[i], spacingFu, reversed) +
          line[i].xAdvance;
      }
      breakIdx = -1;
    }

    width +=
      spacingBetween(line[line.length - 1], g, spacingFu, reversed) +
      g.xAdvance;
    line.push(g);
    if (
      g.charClass === GlyphCharClass.Whitespace ||
      g.charClass === GlyphCharClass.Ideographic
    ) {
      breakIdx = line.length - 1;
    }
  }

  lines.push(line);
  return lines;
}

/** One positioned glyph quad in em space, ready to become an instance. */
export type GlyphQuad = {
  offsetEmX: number;
  offsetEmY: number;
  sizeEmX: number;
  sizeEmY: number;
  /** Atlas sub-rect in PIXEL space; the shader divides by the live atlas size
   *  uniform so an atlas resize doesn't invalidate the instance data. */
  uvL: number;
  uvT: number;
  uvR: number;
  uvB: number;
  /** Sample the COLRv1 colour atlas rather than the SDF atlas. */
  isColor: boolean;
  /**
   * Centre, along x in em, of the rigid piece this glyph belongs to — the same
   * value for every glyph in the piece. A piece is a word, or the glyph alone
   * with `spreadGlyphs`.
   *
   * Line placement puts each piece on the curve rigidly and lays its glyphs
   * out along that piece's tangent. Word pieces keep a word's letters square
   * to each other on a tight bend, where per-glyph tangents splay them apart.
   * Unused when the label is placed at a point.
   */
  wordCenterEmX: number;
};

/** A laid-out label: its glyph quads plus the block metrics the shader and the
 *  declutter pass need. All measurements are in ems. */
export type LabelLayout = {
  quads: GlyphQuad[];
  /** Unique atlas glyphs referenced, for retain/release against the atlas. */
  glyphKeys: bigint[];
  widthEm: number;
  heightEm: number;
  /** Y bounds of the actual rendered glyph bboxes, for the background quad. */
  minYEm: number;
  maxYEm: number;
  /** X bounds of the rendered glyph bboxes, from the layout's left edge. A
   *  glyph's ink can overhang its advance, so these can fall outside
   *  `[0, widthEm]`; line placement measures the drawn text by them. */
  minXEm: number;
  maxXEm: number;
  /** Half the width of the widest piece (see `GlyphQuad.wordCenterEmX`): how
   *  far line placement's rigid pieces can run along their own tangent from
   *  where they sit on the curve. */
  maxWordHalfEm: number;
  /** Half the width of the widest glyph quad: how far a glyph spun about its
   *  own centre by `rotation` can reach from it along a line. */
  maxGlyphHalfEm: number;
};

export type LayoutOptions = {
  /** Wrap width in ems (multiples of font size); 0 disables soft wrapping. */
  maxWidth: number;
  /** Multiplier on the font's natural line height. */
  lineHeight: number;
  /** 0 left, 0.5 center, 1 right. */
  textAlign: number;
  /** Make every glyph its own rigid piece along a line instead of its word. */
  spreadGlyphs: boolean;
  /** Extra space between characters in ems; ignored when the shaping result
   *  disallows it (`allowsLetterSpacing`). Defaults to 0. */
  letterSpacing?: number;
};

const EMPTY_LAYOUT: LabelLayout = {
  quads: [],
  glyphKeys: [],
  widthEm: 0,
  heightEm: 0,
  minYEm: 0,
  maxYEm: 1,
  minXEm: 0,
  maxXEm: 0,
  maxWordHalfEm: 0,
  maxGlyphHalfEm: 0,
};

/**
 * Give every quad from `start` to the end of `quads` the centre of the word
 * they form, measured across the glyphs' own bounding boxes.
 *
 * Taken from the drawn extent rather than the advance width so the word sits on
 * the curve where it looks centred, not where its trailing side bearing would
 * put it. Returns half that extent.
 */
function assignWordCenter(quads: GlyphQuad[], start: number): number {
  if (quads.length <= start) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = start; i < quads.length; i++) {
    minX = Math.min(minX, quads[i].offsetEmX);
    maxX = Math.max(maxX, quads[i].offsetEmX + quads[i].sizeEmX);
  }
  const center = (minX + maxX) * 0.5;
  for (let i = start; i < quads.length; i++) quads[i].wordCenterEmX = center;
  return (maxX - minX) * 0.5;
}

/**
 * Turn a shaping result into positioned glyph quads.
 *
 * Lines lay out top-down: line 0 keeps its baseline at y=0, later baselines
 * step down by the line height, and alignment shifts each line within the
 * widest line's width. Each glyph carries its own normalization scale so SDF
 * and colour glyphs share one em-space coordinate system downstream — the two
 * paths rasterize at different sizes (`SDF_PX_SIZE` vs `COLOR_GLYPH_PX_SIZE`)
 * but both end up in ems after dividing by their respective pixel size.
 */
export function buildLabelLayout(
  shapeResult: ShapeTextResult,
  options: LayoutOptions,
): LabelLayout {
  const { glyphs, metrics, unitsPerEm, ascender, descender, lineGap } =
    shapeResult;

  // Keys are pre-computed by the WASM font worker (composite_key in Rust) so
  // the key layout stays in sync between Rust and TypeScript.
  const metricsMap = new Map<bigint, GlyphMetrics>();
  for (const m of metrics) metricsMap.set(m.compositeKey, m);

  const fontUnitToSdfPx = SDF_PX_SIZE / unitsPerEm;
  const fontUnitToColorPx = COLOR_GLYPH_PX_SIZE / unitsPerEm;

  // Baseline-to-baseline distance in font units. Older cached results may
  // predate line metrics; fall back to one em.
  const naturalLineHeight = ascender - descender + lineGap;
  const lineHeightFu =
    (naturalLineHeight > 0 ? naturalLineHeight : unitsPerEm) *
    options.lineHeight;

  // `maxWidth` and `letterSpacing` are in ems so they track the font size in
  // both sizeInMeters modes; font units are ems × unitsPerEm.
  const spacingFu = shapeResult.allowsLetterSpacing
    ? (options.letterSpacing ?? 0) * unitsPerEm
    : 0;
  const lines = breakLines(glyphs, options.maxWidth * unitsPerEm, spacingFu);
  const widths = lines.map((line) => lineWidthFu(line, spacingFu));
  const blockWidthFu = Math.max(...widths);

  const quads: GlyphQuad[] = [];
  const glyphKeys = new Set<bigint>();
  let minYEm = Infinity;
  let maxYEm = -Infinity;
  let minXEm = Infinity;
  let maxXEm = -Infinity;
  let maxWordHalfEm = 0;
  let maxGlyphHalfEm = 0;

  for (let li = 0; li < lines.length; li++) {
    let cursorX = (blockWidthFu - widths[li]) * options.textAlign;
    let cursorY = -li * lineHeightFu;
    // Start of the word being laid out, as an index into `quads`. Only the
    // shaper's whitespace closes a word (as does the end of a line): drawing
    // nothing is not enough, since a join control (ZWJ/ZWNJ) or a glyph missing
    // from the atlas has no quad yet sits inside its word, and splitting there
    // would turn one joined word into independently rotated pieces. Drawing
    // something is not enough to continue one either: a space with ink (U+1680
    // OGHAM SPACE MARK) still separates words, and is a piece of its own.
    let wordStart = quads.length;
    const closePiece = () => {
      maxWordHalfEm = Math.max(
        maxWordHalfEm,
        assignWordCenter(quads, wordStart),
      );
      wordStart = quads.length;
    };

    const line = lines[li];
    for (let gi = 0; gi < line.length; gi++) {
      const glyph = line[gi];
      const isSpace = glyph.charClass === GlyphCharClass.Whitespace;
      if (isSpace) closePiece();
      cursorX += spacingBetween(line[gi - 1], glyph, spacingFu);
      const m = metricsMap.get(glyph.compositeKey);
      if (m && m.atlasW > 0 && m.atlasH > 0) {
        glyphKeys.add(glyph.compositeKey);
        const px = m.isColor ? COLOR_GLYPH_PX_SIZE : SDF_PX_SIZE;
        const fuToPx = m.isColor ? fontUnitToColorPx : fontUnitToSdfPx;
        const offsetEmX =
          ((cursorX + glyph.xOffset) * fuToPx + m.bearingX) / px;
        const offsetEmY =
          ((cursorY + glyph.yOffset) * fuToPx + m.bearingY) / px;
        const sizeEmX = m.atlasW / px;
        const sizeEmY = m.atlasH / px;

        minYEm = Math.min(minYEm, offsetEmY);
        maxYEm = Math.max(maxYEm, offsetEmY + sizeEmY);
        minXEm = Math.min(minXEm, offsetEmX);
        maxXEm = Math.max(maxXEm, offsetEmX + sizeEmX);
        maxGlyphHalfEm = Math.max(maxGlyphHalfEm, sizeEmX * 0.5);

        quads.push({
          offsetEmX,
          offsetEmY,
          sizeEmX,
          sizeEmY,
          uvL: m.atlasX,
          uvT: m.atlasY,
          uvR: m.atlasX + m.atlasW,
          uvB: m.atlasY + m.atlasH,
          isColor: m.isColor,
          // Filled in once the piece is complete.
          wordCenterEmX: 0,
        });
        if (options.spreadGlyphs || isSpace) closePiece();
      }
      cursorX += glyph.xAdvance;
      cursorY += glyph.yAdvance;
    }
    closePiece();
  }

  if (quads.length === 0) {
    // Glyphs may have shaped but all been blank (whitespace only) — the label
    // still has no collision box and nothing to draw.
    return { ...EMPTY_LAYOUT, glyphKeys: [...glyphKeys] };
  }

  // The block is as wide as its widest line and grows downward by one line
  // height per extra line (a single line stays exactly one em tall).
  return {
    quads,
    glyphKeys: [...glyphKeys],
    widthEm: (blockWidthFu * fontUnitToSdfPx) / SDF_PX_SIZE,
    heightEm:
      (SDF_PX_SIZE + (lines.length - 1) * lineHeightFu * fontUnitToSdfPx) /
      SDF_PX_SIZE,
    minYEm,
    maxYEm,
    minXEm,
    maxXEm,
    maxWordHalfEm,
    maxGlyphHalfEm,
  };
}
