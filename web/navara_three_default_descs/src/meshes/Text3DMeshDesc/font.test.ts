import type { Font as OpenTypeFont, Glyph, PathCommand } from "opentype.js";
import { Box2, type Shape } from "three";
import { Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import { describe, expect, it } from "vitest";

import { createOpenTypeFont, parseTextFont, type TextFont } from "./font";

// 1000 units per em make 720 font units one unit of size, so SIZE scales
// font units by exactly 0.5.
const SIZE = 360;

/** A closed rectangle in font units (Y up). */
const rect = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  clockwise: boolean,
): PathCommand[] => {
  const upFirst: PathCommand[] = [
    { type: "M", x: x0, y: y0 },
    { type: "L", x: x0, y: y1 },
    { type: "L", x: x1, y: y1 },
    { type: "L", x: x1, y: y0 },
  ];
  const rightFirst: PathCommand[] = [
    { type: "M", x: x0, y: y0 },
    { type: "L", x: x1, y: y0 },
    { type: "L", x: x1, y: y1 },
    { type: "L", x: x0, y: y1 },
  ];
  return [...(clockwise ? upFirst : rightFirst), { type: "Z" }];
};

const glyph = (commands: PathCommand[], advanceWidth = 720): Glyph => ({
  advanceWidth,
  path: { commands },
});

const SPACE = glyph([], 360);

const openTypeFont = (glyphs: Record<string, Glyph>): OpenTypeFont => ({
  unitsPerEm: 1000,
  tables: { hhea: { ascender: 900, descender: -360, lineGap: 0 } },
  charToGlyph: (char) => glyphs[char] ?? SPACE,
});

const SQUARE = glyph(rect(0, 0, 720, 720, true));
const RING = glyph([
  ...rect(0, 0, 720, 720, true),
  ...rect(180, 180, 540, 540, false),
]);
// A quadratic then a cubic curve back to the start.
const CURVED = glyph([
  { type: "M", x: 0, y: 0 },
  { type: "Q", x1: 0, y1: 720, x: 720, y: 720 },
  { type: "C", x1: 720, y1: 360, x2: 360, y2: 0, x: 0, y: 0 },
  { type: "Z" },
]);

const font = createOpenTypeFont(
  openTypeFont({ a: SQUARE, o: RING, c: CURVED }),
);

/** Lays `text` out with three.js `Font`, as `TextGeometry` does. */
const layout = (textFont: TextFont, text: string): Shape[] =>
  new Font(textFont.dataFor(text)).generateShapes(text, SIZE);

// The square glyph as typeface.json: font units times 25 / 18.
const typeface: FontData = {
  glyphs: {
    a: {
      ha: 1000,
      x_min: 0,
      x_max: 1000,
      o: "m 0 0 l 0 1000 l 1000 1000 l 1000 0 ",
    },
    "?": {
      ha: 1000,
      x_min: 0,
      x_max: 1000,
      o: "m 0 0 l 0 1000 l 1000 1000 l 1000 0 ",
    },
  },
  familyName: "Test",
  ascender: 1250,
  descender: -500,
  underlinePosition: 0,
  underlineThickness: 0,
  boundingBox: { xMin: 0, xMax: 1000, yMin: -500, yMax: 1250 },
  resolution: 1000,
  original_font_information: {},
};

const bounds = (shapes: Shape[]) =>
  new Box2().setFromPoints(shapes.flatMap((shape) => shape.getPoints()));

const pointsOf = (shape: Shape) =>
  shape.getPoints(2).map((point) => point.toArray());

const toBuffer = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

describe("createOpenTypeFont", () => {
  it("turns an inner contour into a hole for either winding", () => {
    const windings = createOpenTypeFont(
      openTypeFont({
        // TrueType outlines run clockwise outside, CFF outlines the other way.
        t: RING,
        p: glyph([
          ...rect(0, 0, 720, 720, false),
          ...rect(180, 180, 540, 540, true),
        ]),
      }),
    );
    for (const char of ["t", "p"]) {
      const shapes = layout(windings, char);
      expect(shapes).toHaveLength(1);
      expect(shapes[0].holes).toHaveLength(1);
    }
  });

  it("traces curves through their own control points", () => {
    expect(pointsOf(layout(font, "c")[0])).toEqual([
      [0, 0],
      [90, 270],
      [360, 360],
      [247.5, 112.5],
      [0, 0],
    ]);
  });

  it("advances by the glyph width, also over a glyph with no outline", () => {
    const shapes = layout(font, "aa a");
    expect(shapes).toHaveLength(3);
    expect(shapes.map((shape) => bounds([shape]).min.x)).toEqual([0, 360, 900]);
  });

  it("spaces lines by the font's own line spacing", () => {
    // (ascender - descender + lineGap) = 1260 font units.
    expect(bounds([layout(font, "a\na")[1]]).min.toArray()).toEqual([0, -630]);
  });
});

describe("parseTextFont", () => {
  it("reads a typeface.json font and draws ? for a missing character", () => {
    const parsed = parseTextFont(toBuffer(JSON.stringify(typeface)));
    expect(layout(parsed, "a")).toHaveLength(1);
    expect(layout(parsed, "x")).toHaveLength(1);
  });
  it("rejects JSON that is not a typeface.json font", () => {
    expect(() => parseTextFont(toBuffer('{"name":"x"}'))).toThrow(
      "typeface.json",
    );
    // The anchor needs the descender.
    const { descender: _, ...withoutDescender } = typeface;
    expect(() =>
      parseTextFont(toBuffer(JSON.stringify(withoutDescender))),
    ).toThrow("typeface.json");
    // A missing character is drawn with the ? glyph.
    const { "?": __, ...glyphs } = typeface.glyphs;
    expect(() =>
      parseTextFont(toBuffer(JSON.stringify({ ...typeface, glyphs }))),
    ).toThrow("typeface.json");
  });

  it("rejects a WOFF2 file, which opentype.js cannot read", async () => {
    const { parse } = await import("opentype.js");
    expect(() => parseTextFont(toBuffer("wOF2".padEnd(64)), parse)).toThrow(
      "WOFF2",
    );
  });
});
