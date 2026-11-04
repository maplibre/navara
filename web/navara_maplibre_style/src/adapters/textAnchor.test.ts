import { describe, expect, it } from "vitest";

import {
  fromRadialOffset,
  fromTextOffset,
  resolveVariableAnchors,
} from "./textAnchor";

// maplibre-gl-js works in 24 px ems with the baseline 7 px below a line's
// top; its pixel values divided by 24 are the expected ems.
const em = (px: number) => px / 24;

describe("fromRadialOffset", () => {
  it("matches MapLibre for every anchor", () => {
    // A 48 px radial offset; diagonals take 48 / √2 on each axis.
    const d = 48 / Math.SQRT2;
    const cases = {
      center: [0, 0],
      left: [48, 0],
      right: [-48, 0],
      top: [0, 48 - 7],
      bottom: [0, -48 + 7],
      "top-left": [d, d - 7],
      "top-right": [-d, d - 7],
      "bottom-left": [d, -d + 7],
      "bottom-right": [-d, -d + 7],
    } as const;
    for (const [anchor, [x, y]] of Object.entries(cases)) {
      const [ox, oy] = fromRadialOffset(anchor as keyof typeof cases, em(48));
      expect(ox).toBeCloseTo(em(x));
      expect(oy).toBeCloseTo(em(y));
    }
  });

  it("ignores a negative offset", () => {
    expect(fromRadialOffset("left", -2)).toEqual([0, 0]);
  });
});

describe("fromTextOffset", () => {
  it("points the offset's sizes away from the anchor's side", () => {
    expect(fromTextOffset("top-left", -1, -2)).toEqual([1, 2 - em(7)]);
    expect(fromTextOffset("bottom-right", 1, 2)).toEqual([-1, -2 + em(7)]);
    expect(fromTextOffset("center", 1, 2)).toEqual([0, 0]);
  });
});

describe("resolveVariableAnchors", () => {
  it("prefers text-variable-anchor-offset, shifting top and bottom to the baseline", () => {
    const anchors = resolveVariableAnchors({
      "text-variable-anchor-offset": ["top", [1, 2], "left", [1, 2]],
      "text-variable-anchor": ["bottom"],
    });
    expect(anchors).toEqual([
      { anchor: "top", offset: { x: 1, y: 2 - em(7) } },
      { anchor: "left", offset: { x: 1, y: 2 } },
    ]);
  });

  it("reads the collection the style-spec evaluator returns", () => {
    const anchors = resolveVariableAnchors({
      "text-variable-anchor-offset": { values: ["bottom", [0, 0]] },
    });
    expect(anchors).toEqual([{ anchor: "bottom", offset: { x: 0, y: em(7) } }]);
  });

  it("takes the radial offset over text-offset when the style sets one", () => {
    const layout = {
      "text-variable-anchor": ["left", "top"],
      "text-offset": [3, 3],
    };
    expect(resolveVariableAnchors(layout)).toEqual([
      { anchor: "left", offset: { x: 3, y: 0 } },
      { anchor: "top", offset: { x: 0, y: 3 - em(7) } },
    ]);
    expect(
      resolveVariableAnchors({ ...layout, "text-radial-offset": 0 }),
    ).toEqual([
      { anchor: "left", offset: { x: 0, y: 0 } },
      { anchor: "top", offset: { x: 0, y: -em(7) } },
    ]);
  });

  it("is undefined without variable anchors", () => {
    expect(resolveVariableAnchors({ "text-offset": [1, 1] })).toBeUndefined();
  });
});
