import { describe, it, expect, vi } from "vitest";

import { fontFamilyToStyleOverrides } from "./fontHelper";

// Mock @navaramap/three to avoid loading navara_worker
vi.mock("@navaramap/three", () => ({
  fetchFontFamilyFromCss: vi.fn(),
}));

describe("fontHelper", () => {
  describe("fontFamilyToStyleOverrides", () => {
    describe("unicode range conversion", () => {
      it("should convert single codepoint ranges (from === to)", () => {
        const fontFamily = {
          family: "TestFont",
          faces: [
            {
              url: "test.woff2",
              unicodeRanges: [{ from: 65, to: 65 }], // 'A'
            },
          ],
        };

        const result = fontFamilyToStyleOverrides(fontFamily);
        const fontFace = result["font-faces"]?.["TestFont"];

        expect(fontFace).toEqual([
          {
            url: "test.woff2",
            "unicode-range": ["U+41-41"],
          },
        ]);
      });

      it("should convert ranges without leading zeros", () => {
        const fontFamily = {
          family: "TestFont",
          faces: [
            {
              url: "test.woff2",
              unicodeRanges: [
                { from: 0, to: 255 }, // Basic Latin + Latin-1
                { from: 256, to: 383 }, // Latin Extended-A
              ],
            },
          ],
        };

        const result = fontFamilyToStyleOverrides(fontFamily);
        const fontFace = result["font-faces"]?.["TestFont"];

        expect(fontFace).toEqual([
          {
            url: "test.woff2",
            "unicode-range": ["U+0-FF", "U+100-17F"],
          },
        ]);
      });

      it("should preserve order of multiple ranges", () => {
        const fontFamily = {
          family: "TestFont",
          faces: [
            {
              url: "test.woff2",
              unicodeRanges: [
                { from: 0x4e00, to: 0x9fff }, // CJK Unified Ideographs
                { from: 0x0400, to: 0x04ff }, // Cyrillic
                { from: 0x0000, to: 0x007f }, // Basic Latin
              ],
            },
          ],
        };

        const result = fontFamilyToStyleOverrides(fontFamily);
        const fontFace = result["font-faces"]?.["TestFont"];

        expect(fontFace).toEqual([
          {
            url: "test.woff2",
            "unicode-range": ["U+4E00-9FFF", "U+400-4FF", "U+0-7F"],
          },
        ]);
      });
    });

    describe("single face without unicode ranges", () => {
      it("should return URL string directly", () => {
        const fontFamily = {
          family: "TestFont",
          faces: [
            {
              url: "test.woff2",
              unicodeRanges: [],
            },
          ],
        };

        const result = fontFamilyToStyleOverrides(fontFamily);

        expect(result).toEqual({
          "font-faces": {
            TestFont: "test.woff2",
          },
        });
      });
    });

    describe("single face with unicode ranges", () => {
      it("should return array format", () => {
        const fontFamily = {
          family: "TestFont",
          faces: [
            {
              url: "test.woff2",
              unicodeRanges: [{ from: 0, to: 255 }],
            },
          ],
        };

        const result = fontFamilyToStyleOverrides(fontFamily);

        expect(result).toEqual({
          "font-faces": {
            TestFont: [
              {
                url: "test.woff2",
                "unicode-range": ["U+0-FF"],
              },
            ],
          },
        });
      });
    });

    describe("multiple faces", () => {
      it("should return array format", () => {
        const fontFamily = {
          family: "TestFont",
          faces: [
            {
              url: "latin.woff2",
              unicodeRanges: [{ from: 0, to: 255 }],
            },
            {
              url: "cyrillic.woff2",
              unicodeRanges: [{ from: 0x0400, to: 0x04ff }],
            },
          ],
        };

        const result = fontFamilyToStyleOverrides(fontFamily);

        expect(result).toEqual({
          "font-faces": {
            TestFont: [
              {
                url: "latin.woff2",
                "unicode-range": ["U+0-FF"],
              },
              {
                url: "cyrillic.woff2",
                "unicode-range": ["U+400-4FF"],
              },
            ],
          },
        });
      });

      it("should omit unicode-range key when face has no ranges", () => {
        const fontFamily = {
          family: "TestFont",
          faces: [
            {
              url: "latin.woff2",
              unicodeRanges: [{ from: 0, to: 255 }],
            },
            {
              url: "fallback.woff2",
              unicodeRanges: [], // No ranges
            },
          ],
        };

        const result = fontFamilyToStyleOverrides(fontFamily);
        const fontFaces = result["font-faces"]?.["TestFont"];

        expect(Array.isArray(fontFaces)).toBe(true);
        const fontFacesArray = fontFaces as unknown as {
          url: string;
          "unicode-range"?: string[];
        }[];
        expect(fontFacesArray[0]).toEqual({
          url: "latin.woff2",
          "unicode-range": ["U+0-FF"],
        });
        expect(fontFacesArray[1]).toEqual({
          url: "fallback.woff2",
          // unicode-range key should not exist
        });
        expect(fontFacesArray[1]).not.toHaveProperty("unicode-range");
      });
    });

    describe("multiple font families", () => {
      it("should merge multiple families into font-faces", () => {
        const font1 = {
          family: "Font1",
          faces: [{ url: "font1.woff2", unicodeRanges: [] }],
        };
        const font2 = {
          family: "Font2",
          faces: [{ url: "font2.woff2", unicodeRanges: [] }],
        };

        const result = fontFamilyToStyleOverrides(font1, font2);

        expect(result).toEqual({
          "font-faces": {
            Font1: "font1.woff2",
            Font2: "font2.woff2",
          },
        });
      });
    });

    describe("edge cases", () => {
      it("should skip families with no faces", () => {
        const fontFamily = {
          family: "EmptyFont",
          faces: [],
        };

        const consoleWarnSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});

        const result = fontFamilyToStyleOverrides(fontFamily);

        expect(result).toEqual({
          "font-faces": {},
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('FontFamily "EmptyFont" has no faces'),
        );

        consoleWarnSpy.mockRestore();
      });

      it("should return empty font-faces when no valid families", () => {
        const result = fontFamilyToStyleOverrides();

        expect(result).toEqual({
          "font-faces": {},
        });
      });
    });
  });

  describe("fetchFontStyleOverrides", () => {
    it("should fetch font family and convert to style overrides", async () => {
      const { fetchFontStyleOverrides } = await import("./fontHelper");
      const { fetchFontFamilyFromCss } = await import("@navaramap/three");

      const mockFontFamily = {
        family: "TestFont",
        faces: [{ url: "https://example.com/test.woff2", unicodeRanges: [] }],
      };

      (fetchFontFamilyFromCss as any).mockResolvedValue(mockFontFamily);

      const result = await fetchFontStyleOverrides(
        "TestFont",
        "https://example.com/font.css",
      );

      expect(fetchFontFamilyFromCss).toHaveBeenCalledWith(
        "TestFont",
        "https://example.com/font.css",
      );
      expect(result).toEqual({
        "font-faces": {
          TestFont: "https://example.com/test.woff2",
        },
      });
    });
  });
});
