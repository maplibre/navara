import { Box3, Mesh, Vector3, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";

import type { TextFont } from "./font";
import { createTextGeometry } from "./geometry";

/** A unit square reaching down to the descender line. */
const SQUARE = {
  ha: 1,
  x_min: 0,
  x_max: 1,
  o: "m 0 -0.5 l 0 0.5 l 1 0.5 l 1 -0.5 ",
};
/** A unit-wide square resting on the baseline. */
const RAISED = { ...SQUARE, o: "m 0 0 l 0 0.5 l 1 0.5 l 1 0 " };
const font: TextFont = {
  dataFor: () => ({
    glyphs: { a: SQUARE, b: RAISED },
    familyName: "Test",
    ascender: 1,
    descender: -0.5,
    underlinePosition: 0,
    underlineThickness: 0,
    // Lines 2 apart.
    boundingBox: { xMin: 0, xMax: 1, yMin: -1, yMax: 1 },
    resolution: 1,
    original_font_information: {},
  }),
};

const boxOf = (geometry: BufferGeometry) =>
  new Box3().setFromObject(new Mesh(geometry));

const sizeOf = (box: Box3) => box.getSize(new Vector3()).toArray();

const expectCentered = (box: Box3) => {
  expect(box.min.x + box.max.x).toBeCloseTo(0);
  expect(box.min.z + box.max.z).toBeCloseTo(0);
};

describe("createTextGeometry", () => {
  it("anchors multi-line text at its bottom center", () => {
    const box = boxOf(
      createTextGeometry(font, { text: "aa\na", size: 10, depth: 4 }),
    );
    expectCentered(box);
    expect(box.min.y).toBeCloseTo(0);
    // Two characters wide, two lines 20 apart, 4 deep.
    expect(sizeOf(box)).toEqual([20, 30, 4]);
  });

  it("defaults to the three.js TextGeometry size, depth and no bevel", () => {
    const box = boxOf(createTextGeometry(font, { text: "a" }));
    expect(sizeOf(box)).toEqual([100, 100, 50]);
  });

  it("spaces lines by lineHeight times size", () => {
    const box = boxOf(
      createTextGeometry(font, { text: "a\na", size: 10, lineHeight: 3 }),
    );
    expect(sizeOf(box)[1]).toBeCloseTo(40);
  });

  it("rests the descender line on the anchor whatever the letters", () => {
    const box = boxOf(createTextGeometry(font, { text: "b\nb", size: 10 }));
    // The last line's baseline sits half a size above the descender line.
    expect(box.min.y).toBeCloseTo(5);
  });

  it("keeps the anchor when the bevel grows the text", () => {
    const box = boxOf(
      createTextGeometry(font, { text: "a", bevelEnabled: true }),
    );
    expectCentered(box);
    // The bevel reaches below the descender line by its size.
    expect(box.min.y).toBeCloseTo(-8);
    // The default bevel adds 8 around the outline and 10 at both ends.
    const [width, height, depth] = sizeOf(box);
    expect(width).toBeCloseTo(116);
    expect(height).toBeCloseTo(116);
    expect(depth).toBeCloseTo(70);
  });

  it("builds an empty geometry for text without an outline", () => {
    const geometry = createTextGeometry(font, { text: "" });
    expect(geometry.getAttribute("position").count).toBe(0);
  });
});
