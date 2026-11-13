// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../external/types/opentype.d.ts" />

import type { Font as OpenTypeFont, PathCommand } from "opentype.js";
import type { FontData } from "three/examples/jsm/loaders/FontLoader.js";
import invariant from "tiny-invariant";

/** A font in the typeface format that three.js `Font` lays out. */
export type TextFont = {
  /** Font data holding at least the glyphs of `text`. */
  dataFor(text: string): FontData;
};

/** `{`: a typeface.json font is a JSON object, a font file never starts so. */
const JSON_OBJECT_START = 0x7b;

/** typeface.json scale: one em spans `size * 100 / 72` at this resolution. */
const TYPEFACE_RESOLUTION = 1000;

/**
 * Converts a TTF font to the typeface format the way three.js `TTFLoader`
 * does, glyph by glyph as text needs them. Lines are spaced by the font's
 * own line spacing.
 */
export function createOpenTypeFont(font: OpenTypeFont): TextFont {
  const scale = (TYPEFACE_RESOLUTION * 100) / (font.unitsPerEm * 72);
  const { ascender, descender, lineGap } = font.tables.hhea;
  const glyphs: FontData["glyphs"] = {};
  const data: FontData = {
    glyphs,
    familyName: "",
    ascender: ascender * scale,
    descender: descender * scale,
    underlinePosition: 0,
    underlineThickness: 0,
    // three.js spaces lines by the height of this box.
    boundingBox: {
      xMin: 0,
      xMax: 0,
      yMin: 0,
      yMax: (ascender - descender + lineGap) * scale,
    },
    resolution: TYPEFACE_RESOLUTION,
    original_font_information: {},
  };
  return {
    dataFor(text) {
      for (const char of text) {
        if (char in glyphs) continue;
        const glyph = font.charToGlyph(char);
        glyphs[char] = {
          ha: glyph.advanceWidth * scale,
          x_min: 0,
          x_max: 0,
          o: glyph.path.commands
            .map((command) => toOutlineToken(command, scale))
            .join(""),
        };
      }
      return data;
    },
  };
}

/** A typeface.json outline command: curves list their end point first. */
function toOutlineToken(command: PathCommand, scale: number): string {
  const p = (...values: number[]) =>
    values.map((value) => ` ${value * scale}`).join("");
  switch (command.type) {
    case "M":
      return `m${p(command.x, command.y)} `;
    case "L":
      return `l${p(command.x, command.y)} `;
    case "Q":
      return `q${p(command.x, command.y, command.x1, command.y1)} `;
    case "C":
      return `b${p(command.x, command.y, command.x1, command.y1, command.x2, command.y2)} `;
    case "Z":
      // Sub-paths are closed implicitly.
      return "";
  }
}

function isFontData(value: unknown): value is FontData {
  return (
    typeof value === "object" &&
    value !== null &&
    "resolution" in value &&
    typeof value.resolution === "number" &&
    "descender" in value &&
    typeof value.descender === "number" &&
    "underlineThickness" in value &&
    typeof value.underlineThickness === "number" &&
    "boundingBox" in value &&
    typeof value.boundingBox === "object" &&
    value.boundingBox !== null &&
    "glyphs" in value &&
    typeof value.glyphs === "object" &&
    value.glyphs !== null &&
    // three.js draws a missing character with this glyph.
    "?" in value.glyphs
  );
}

type ParseOpenType = (buffer: ArrayBuffer) => OpenTypeFont;

function isTypefaceJson(buffer: ArrayBuffer): boolean {
  return new Uint8Array(buffer)[0] === JSON_OBJECT_START;
}

/**
 * Reads a font from the bytes of a TTF file or of a three.js
 * typeface.json font. The format is detected from the content; a font file
 * needs `parseOpenType`.
 */
export function parseTextFont(
  buffer: ArrayBuffer,
  parseOpenType?: ParseOpenType,
): TextFont {
  if (isTypefaceJson(buffer)) {
    const data: unknown = JSON.parse(new TextDecoder().decode(buffer));
    if (!isFontData(data)) {
      throw new Error("the JSON is not a typeface.json font");
    }
    return { dataFor: () => data };
  }
  invariant(parseOpenType, "a font file needs the OpenType parser");
  return createOpenTypeFont(parseOpenType(buffer));
}

/** Fetches and reads the font at `url`. */
export async function loadTextFont(url: string): Promise<TextFont> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Text3DMeshDesc: text3D.font could not be fetched (${url}): HTTP ${response.status}`,
    );
  }
  const buffer = await response.arrayBuffer();
  // Loaded on demand, and outside the relabelling below: a missing parser
  // chunk is not a font problem.
  const parseOpenType = isTypefaceJson(buffer)
    ? undefined
    : (await import("opentype.js")).parse;
  try {
    return parseTextFont(buffer, parseOpenType);
  } catch (error) {
    // Names the URL: a wrong path often answers 200 with an HTML page.
    if (error instanceof Error) {
      error.message = `Text3DMeshDesc: text3D.font is not a readable font (${url}): ${error.message}`;
    }
    throw error;
  }
}
