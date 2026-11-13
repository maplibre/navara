// opentype.js ships no types; only what Text3DMeshDesc reads is declared.
declare module "opentype.js" {
  /** Outline commands in font units, with the Y axis pointing up. */
  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | {
        type: "C";
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        x: number;
        y: number;
      }
    | { type: "Z" };

  export type Glyph = {
    advanceWidth: number;
    path: { commands: PathCommand[] };
  };

  export type Font = {
    unitsPerEm: number;
    tables: {
      hhea: { ascender: number; descender: number; lineGap: number };
    };
    /** Falls back to the font's `.notdef` glyph for unmapped characters. */
    charToGlyph(char: string): Glyph;
  };

  export function parse(buffer: ArrayBuffer): Font;
}
