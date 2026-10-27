import { describe, expect, it } from "vitest";

import { parseColorReliefStops, toColorReliefRamp } from "./colorRelief";

const relief = (...stops: (number | string)[]) => [
  "interpolate",
  ["linear"],
  ["elevation"],
  ...stops,
];

const expectRGBA = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 6));
};

describe("parseColorReliefStops", () => {
  it("returns stops sorted by elevation", () => {
    expect(
      parseColorReliefStops(
        relief(3000, "#ffffff", 0, "#000000", 100, "#ff0000"),
      ),
    ).toEqual([
      { elevation: 0, color: [0, 0, 0, 1] },
      { elevation: 100, color: [1, 0, 0, 1] },
      { elevation: 3000, color: [1, 1, 1, 1] },
    ]);
  });

  it("keeps alpha with premultiplied color", () => {
    const stops = parseColorReliefStops(
      relief(0, "rgba(0,0,0,0)", 100, "rgba(255,0,0,0.5)"),
    );
    expect(stops?.[0]).toEqual({ elevation: 0, color: [0, 0, 0, 0] });
    expectRGBA(stops?.[1]?.color ?? [], [0.5, 0, 0, 0.5]);
  });

  it("drops a stop whose color fails to parse without shifting others", () => {
    expect(
      parseColorReliefStops(
        relief(0, "#000000", 100, "not-a-color", 200, "#ffffff"),
      ),
    ).toEqual([
      { elevation: 0, color: [0, 0, 0, 1] },
      { elevation: 200, color: [1, 1, 1, 1] },
    ]);
  });

  it("accepts every interpolation type and interpolate operator", () => {
    const expected = [
      { elevation: 0, color: [0, 0, 0, 1] },
      { elevation: 100, color: [1, 1, 1, 1] },
    ];
    for (const [operator, interpolation] of [
      ["interpolate", ["exponential", 2]],
      ["interpolate", ["cubic-bezier", 0.4, 0, 0.6, 1]],
      ["interpolate-hcl", ["linear"]],
      ["interpolate-lab", ["linear"]],
    ]) {
      expect(
        parseColorReliefStops([
          operator,
          interpolation,
          ["elevation"],
          0,
          "#000000",
          100,
          "#ffffff",
        ]),
      ).toEqual(expected);
    }
  });

  it("returns undefined for non-interpolate values", () => {
    expect(parseColorReliefStops("#ff0000")).toBeUndefined();
    expect(parseColorReliefStops(["step", ["elevation"]])).toBeUndefined();
    expect(
      parseColorReliefStops([
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        "red",
        10,
        "blue",
      ]),
    ).toBeUndefined();
  });
});

describe("toColorReliefRamp", () => {
  it("passes each stop's color and elevation through exactly", () => {
    const ramp = toColorReliefRamp([
      { elevation: 0, color: [0, 0, 0, 1] },
      { elevation: 100, color: [1, 0, 0, 1] },
      { elevation: 3000, color: [1, 1, 1, 1] },
    ]);
    expect(ramp?.minHeight).toBe(0);
    expect(ramp?.maxHeight).toBe(3000);
    expect(Array.from(ramp?.colorStops ?? [])).toEqual([0, 100, 3000]);
    expect(Array.from(ramp?.colorMap ?? [])).toEqual([
      0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1,
    ]);
  });

  it("un-premultiplies colors for the straight-alpha colorMap", () => {
    const ramp = toColorReliefRamp([
      { elevation: 0, color: [0, 0, 0, 0] },
      { elevation: 10, color: [0.5, 0, 0, 0.5] },
    ]);
    expectRGBA(Array.from(ramp?.colorMap ?? []), [0, 0, 0, 0, 1, 0, 0, 0.5]);
  });

  it("widens a single stop's range so normalization cannot divide by zero", () => {
    const ramp = toColorReliefRamp([{ elevation: 500, color: [0, 1, 0, 1] }]);
    expect(ramp).toMatchObject({ minHeight: 500, maxHeight: 501 });
    expect(Array.from(ramp?.colorStops ?? [])).toEqual([500]);
  });

  it("returns undefined without stops", () => {
    expect(toColorReliefRamp([])).toBeUndefined();
  });
});
