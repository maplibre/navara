import { describe, expect, it } from "vitest";

import {
  LINE_LABEL_FIT_STRIDE,
  LINE_LABEL_STRIDE,
  PATH_META_STRIDE,
  SCALE_BAND_STRIDE,
  findRepeatedLabels,
  LineGlyphMode,
  lineGlyphMode,
  type LinePath,
  type PackableLabel,
  packLineLabelFits,
  packLineLabels,
  takeLinePath,
} from "./linePlacement";

/** 32 samples per anchor, matching `PATH_SAMPLES` in line_placement.rs. */
const SAMPLES = 32;

/**
 * One anchor's path. `stepMeters` and `realLineMeters` are the two scalars the
 * engine sends alongside the samples; the sample values themselves are never
 * read by the packing under test.
 */
function path(stepMeters: number, realLineMeters: number): LinePath {
  const meta = new Float32Array(PATH_META_STRIDE);
  meta[0] = stepMeters;
  meta[1] = realLineMeters;
  return {
    samples: new Float32Array(SAMPLES * 2),
    stride: SAMPLES * 2,
    meta,
    bearings: new Float32Array([0]),
    scaleBands: new Float32Array([0, Infinity]),
  };
}

/** A label whose ink spans exactly its advance box unless told otherwise,
 *  centred on its anchor with the baseline on it. */
function label(over: Partial<PackableLabel> = {}): PackableLabel {
  const widthEm = over.widthEm ?? 4;
  return {
    slot: 0,
    instanceIndex: 0,
    anchor: new Float64Array([1, 2, 3]),
    addHeight: 0,
    widthEm,
    shiftEm: [-widthEm / 2, 0],
    minYEm: 0,
    maxYEm: 1,
    minXEm: 0,
    maxXEm: widthEm,
    maxWordHalfEm: 1.5,
    maxGlyphHalfEm: 0.4,
    fontSize: 10,
    ...over,
  };
}

const options = {
  sizeInMeters: true,
  maxAngleDeg: 45,
  keepUpright: true,
  lineOffset: 0,
  readFlip: () => false,
  readOrientation: () => ({
    flatFacing: true,
    mode: LineGlyphMode.Ground,
    rotation: 0,
  }),
};

/** The span the samples cover either side of the anchor. */
const spanFor = (stepMeters: number) => 0.5 * (SAMPLES - 1) * stepMeters;

describe("usable half extent", () => {
  // A label longer than the sampled path does not fail gracefully: the vertex
  // shader clamps its lookup to the last sample, so the far end of the label
  // piles onto that one point and its words overlap. The extent handed to the
  // kernel therefore has to be capped by the span, not just by the road.
  it("caps the extent at the sampled span when the road is longer", () => {
    const step = 2;
    const span = spanFor(step); // 31 m
    const p = path(step, 10_000); // road far longer than the samples cover

    const fit = packLineLabelFits([label()], p, options);
    expect(fit[7]).toBeCloseTo(span, 5);

    const full = packLineLabels([label()], p, options);
    expect(full.labels[10]).toBeCloseTo(span, 5);
  });

  it("keeps the road limit when the road is the shorter of the two", () => {
    const step = 100;
    const p = path(step, 12); // only 12 m of road, samples cover 1550 m

    expect(packLineLabelFits([label()], p, options)[7]).toBeCloseTo(12, 5);
    expect(packLineLabels([label()], p, options).labels[10]).toBeCloseTo(12, 5);
  });

  it("gives both packings the same extent for the same anchor", () => {
    // The two phases must agree about what fits, or the cheap pre-pass would
    // admit labels the full pass then rejects — or worse, the other way round.
    for (const [step, road] of [
      [2, 10_000],
      [100, 12],
      [4, 60],
      [0, 500],
    ]) {
      const p = path(step, road);
      expect(packLineLabelFits([label()], p, options)[7]).toBe(
        packLineLabels([label()], p, options).labels[10],
      );
    }
  });

  it("reads the meta of the label's own anchor", () => {
    // Labels are created sparsely, so a label's `instanceIndex` addresses its
    // run in the shared meta array rather than its position in the input.
    const meta = new Float32Array(PATH_META_STRIDE * 3);
    meta[0] = 100;
    meta[1] = 5; // anchor 0: short road
    meta[PATH_META_STRIDE * 2] = 100;
    meta[PATH_META_STRIDE * 2 + 1] = 7; // anchor 2: slightly longer
    const p: LinePath = {
      samples: new Float32Array(SAMPLES * 2 * 3),
      stride: SAMPLES * 2,
      meta,
      bearings: new Float32Array([0, 0, 0]),
      scaleBands: new Float32Array(SCALE_BAND_STRIDE * 3),
    };

    const fit = packLineLabelFits([label({ instanceIndex: 2 })], p, options);
    expect(fit[7]).toBeCloseTo(7, 5);
  });
});

describe("scale band", () => {
  it("sends the label's own anchor's band to both phases", () => {
    // Text stacks one anchor per level on a position, so a label reading its
    // neighbour's band would show at the wrong zoom.
    const bands = new Float32Array(SCALE_BAND_STRIDE * 3);
    bands.set([0, 1, 1, 2, 2, Infinity]);
    const p: LinePath = { ...path(10, 500), scaleBands: bands };
    const l = label({ instanceIndex: 1 });

    expect([...packLineLabelFits([l], p, options).slice(8, 10)]).toEqual([
      1, 2,
    ]);
    expect([...packLineLabels([l], p, options).labels.slice(19, 21)]).toEqual([
      1, 2,
    ]);
  });
});

describe("label width", () => {
  it("sends the full width to both phases, whatever the anchor offset", () => {
    // The kernel stretches the spacing for a label longer than it, measured
    // end to end as MapLibre does — not by the side that reaches furthest.
    const p = path(10, 500);
    const l = label({ widthEm: 7, shiftEm: [0, 0] });
    expect(packLineLabelFits([l], p, options)[10]).toBe(7);
    expect(packLineLabels([l], p, options).labels[21]).toBe(7);
  });

  it("measures glyphs that overhang their advance by their ink", () => {
    // A 1-em advance whose glyph draws over [-0.2, 1.2], centred, at size 16.
    // By advance it reaches 8 either side and fits an 8-unit half-line; it
    // actually draws to ±11.2, so the fit, the box and the spacing stretch
    // must all see that.
    const p = path(10, 500);
    const l = label({ widthEm: 1, minXEm: -0.2, maxXEm: 1.2, fontSize: 16 });

    const fit = packLineLabelFits([l], p, options);
    expect(fit[4] * l.fontSize).toBeCloseTo(11.2, 5);
    expect(fit[10]).toBeCloseTo(1.4, 5);

    const full = packLineLabels([l], p, options).labels;
    expect(full[4] * l.fontSize).toBeCloseTo(11.2, 5);
    expect(full[13]).toBeCloseTo(-11.2, 5);
    expect(full[14]).toBeCloseTo(11.2, 5);
    expect(full[21]).toBeCloseTo(1.4, 5);

    // Off-centre, the ink is measured from the same origin as the advance:
    // anchored at the left edge, it reaches 0.2 em back and 1.2 em forward.
    const left = packLineLabels([{ ...l, shiftEm: [0, 0] }], p, options).labels;
    expect(left[13]).toBeCloseTo(-0.2 * 16, 5);
    expect(left[14]).toBeCloseTo(1.2 * 16, 5);
  });

  it("sends the widest word's reach in the font's own units", () => {
    // The kernel bounds each rigid word along its own tangent, so it needs
    // the reach in the same units as the box: ems times the font size.
    const l = label({ maxWordHalfEm: 1.5, fontSize: 10 });
    expect(packLineLabels([l], path(10, 500), options).labels[22]).toBe(15);
  });
});

describe("findRepeatedLabels", () => {
  const at = (instanceIndex: number, text: string, x: number) => ({
    instanceIndex,
    text,
    anchor: new Float64Array([x, 0, 0]),
  });

  it("drops a same-text label closer than half the spacing", () => {
    // 250 px at 2 m/px: repeats closer than 250 m are dropped.
    const labels = [at(0, "Main St", 0), at(1, "Main St", 200)];
    expect(findRepeatedLabels(labels, [2, 2], 250)).toEqual([1]);
    const apart = [at(0, "Main St", 0), at(1, "Main St", 300)];
    expect(findRepeatedLabels(apart, [2, 2], 250)).toEqual([]);
  });

  it("never compares different text", () => {
    const labels = [at(0, "Main St", 0), at(1, "High St", 1)];
    expect(findRepeatedLabels(labels, [2, 2], 250)).toEqual([]);
  });

  it("keeps the earlier anchor, whatever order the labels arrive in", () => {
    // Slots are handed out lazily, so the pass's order is not anchor order.
    const labels = [at(5, "Main St", 0), at(2, "Main St", 10)];
    expect(findRepeatedLabels(labels, [2, 2], 250)).toEqual([0]);
  });

  it("measures against kept labels only", () => {
    // B is dropped for A; C is far enough from A, so B must not hide it.
    const labels = [
      at(0, "Main St", 0),
      at(1, "Main St", 200),
      at(2, "Main St", 400),
    ];
    expect(findRepeatedLabels(labels, [2, 2, 2], 250)).toEqual([1]);
  });

  it("agrees with comparing every pair, at every scale in a view", () => {
    // The grid files anchors at several cell sizes because the limit varies
    // with each label's scale, as across a pitched view; it must drop
    // exactly what the plain all-pairs comparison drops.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const texts = ["Main St", "High St", "Mill Rd"];
    const labels = Array.from({ length: 600 }, (_, i) => ({
      instanceIndex: (i * 37) % 600,
      text: texts[i % texts.length],
      anchor: new Float64Array([
        (random() - 0.5) * 2e5,
        (random() - 0.5) * 2e5,
        (random() - 0.5) * 2e3,
      ]),
    }));
    const metersPerPx = labels.map(() => 10 ** (random() * 3 - 1));

    const expected: number[] = [];
    const kept: number[] = [];
    const order = labels.map((_, i) => i);
    order.sort((a, b) => labels[a].instanceIndex - labels[b].instanceIndex);
    for (const i of order) {
      const limit = 0.5 * 250 * metersPerPx[i];
      const a = labels[i].anchor;
      const close = kept.some((k) => {
        const o = labels[k].anchor;
        if (labels[k].text !== labels[i].text) return false;
        return (
          (o[0] - a[0]) ** 2 + (o[1] - a[1]) ** 2 + (o[2] - a[2]) ** 2 <
          limit * limit
        );
      });
      if (close) expected.push(i);
      else kept.push(i);
    }

    expect(expected.length).toBeGreaterThan(0);
    expect(findRepeatedLabels(labels, metersPerPx, 250)).toEqual(expected);
  });

  it("drops nothing when the spacing places no pattern", () => {
    const labels = [at(0, "Main St", 0), at(1, "Main St", 1)];
    for (const spacing of [0, -1, Number.NaN, Infinity]) {
      expect(findRepeatedLabels(labels, [2, 2], spacing)).toEqual([]);
    }
  });
});

describe("packing shape", () => {
  it("writes one stride per label in input order", () => {
    const p = path(10, 500);
    const labels = [label({ slot: 0 }), label({ slot: 1, widthEm: 9 })];

    const fit = packLineLabelFits(labels, p, {
      ...options,
      sizeInMeters: false,
    });
    expect(fit.length).toBe(labels.length * LINE_LABEL_FIT_STRIDE);
    // Centred, so each label reaches half its width either side.
    expect(fit[4]).toBe(2);
    expect(fit[LINE_LABEL_FIT_STRIDE + 4]).toBe(4.5);

    const full = packLineLabels(labels, p, options);
    expect(full.labels.length).toBe(labels.length * LINE_LABEL_STRIDE);
    expect(full.paths.length).toBe(labels.length * p.stride);
  });
});

describe("anchor and offset", () => {
  // The shader lays text over [shiftX, w + shiftX] around the anchor, so an
  // off-centre anchor or an x offset leaves one side needing more line than
  // half the width.
  it("fits the longer side of an off-centre label", () => {
    const p = path(10, 500);
    for (const [shiftX, reach] of [
      [-2, 2],
      [0, 4],
      [2, 6],
    ]) {
      const l = label({ shiftEm: [shiftX, 0] });
      expect(packLineLabelFits([l], p, options)[4]).toBe(reach);
      expect(packLineLabels([l], p, options).labels[4]).toBe(reach);
    }
  });

  it("moves the box by the vertical shift", () => {
    const p = path(10, 500);
    const l = label({ shiftEm: [-2, -0.5], minYEm: -0.2, maxYEm: 0.8 });
    const box = packLineLabels([l], p, options).labels;
    expect(box[15]).toBeCloseTo((-0.2 - 0.5) * 10, 5);
    expect(box[16]).toBeCloseTo((0.8 - 0.5) * 10, 5);
  });

  it("sends the anchor's height to both phases", () => {
    const p = path(10, 500);
    const raised = label({ addHeight: 120 });
    expect(packLineLabelFits([raised], p, options)[3]).toBe(120);
    expect(packLineLabels([raised], p, options).labels[3]).toBe(120);
  });

  it("keeps the line offset apart from the text's own height", () => {
    // Upright text stands its height along the surface normal but is offset
    // across the ground, so the kernel has to be able to tell the two apart.
    const p = path(10, 500);
    const plain = packLineLabels([label()], p, options).labels;
    const lifted = packLineLabels([label()], p, {
      ...options,
      lineOffset: 7,
    }).labels;
    expect(lifted[17]).toBe(7);
    expect(lifted.slice(13, 17)).toEqual(plain.slice(13, 17));
  });

  it("resolves the orientation per label, in both phases", () => {
    const p = path(10, 500);
    const labels = [label({ slot: 0 }), label({ slot: 1 })];
    const perLabel = {
      ...options,
      readOrientation: (slot: number) => ({
        flatFacing: slot === 1,
        mode: slot === 0 ? LineGlyphMode.ScreenTangent : LineGlyphMode.Ground,
        rotation: slot === 0 ? 0.5 : 0,
      }),
    };
    const packed = packLineLabels(labels, p, perLabel).labels;
    const both = (k: number) => [packed[k], packed[LINE_LABEL_STRIDE + k]];
    expect(both(18)).toEqual([0, 1]);
    expect(both(23)).toEqual([
      LineGlyphMode.ScreenTangent,
      LineGlyphMode.Ground,
    ]);
    expect(both(24)).toEqual([0.5, 0]);
    // The widest glyph's half, in the font size's units.
    expect(both(25)).toEqual([4, 4]);
    const fit = packLineLabelFits(labels, p, perLabel);
    expect([fit[11], fit[LINE_LABEL_FIT_STRIDE + 11]]).toEqual([
      LineGlyphMode.ScreenTangent,
      LineGlyphMode.Ground,
    ]);
  });
});

describe("lineGlyphMode", () => {
  // MapLibre's text-rotation-alignment on a line: `map` follows the line
  // (on the ground when pitched with the map, on screen otherwise),
  // `viewport-glyph` turns each glyph to the camera, `viewport` does not bend.
  it.each([
    [true, false, false, LineGlyphMode.Ground],
    [true, false, true, LineGlyphMode.Ground],
    [false, false, false, LineGlyphMode.ScreenTangent],
    [false, false, true, LineGlyphMode.ScreenTangent],
    [true, true, true, LineGlyphMode.FacesCamera],
    [false, true, true, LineGlyphMode.FacesCamera],
    [true, true, false, LineGlyphMode.Straight],
    [false, true, false, LineGlyphMode.Straight],
  ])(
    "flat %s, rotateWithCamera %s, spreadGlyphs %s",
    (flatFacing, rotateWithCamera, spreadGlyphs, mode) => {
      expect(
        lineGlyphMode({ flatFacing, rotateWithCamera, spreadGlyphs }),
      ).toBe(mode);
    },
  );
});

describe("takeLinePath", () => {
  it("returns null when the geometry carries no path", () => {
    expect(takeLinePath(null)).toBeNull();
    expect(
      takeLinePath({
        pathSamples: null,
        pathStride: 0,
        pathMeta: null,
        bearings: null,
        scaleBands: null,
      }),
    ).toBeNull();
  });

  it("lifts the path out when one is present", () => {
    const samples = new Float32Array(4);
    const lifted = takeLinePath({
      pathSamples: samples,
      pathStride: 4,
      pathMeta: new Float32Array(PATH_META_STRIDE),
      bearings: new Float32Array(1),
      scaleBands: new Float32Array(SCALE_BAND_STRIDE),
    });
    expect(lifted?.samples).toBe(samples);
    expect(lifted?.stride).toBe(4);
  });

  it("rejects a path that arrives without its meta", () => {
    expect(() =>
      takeLinePath({
        pathSamples: new Float32Array(4),
        pathStride: 4,
        pathMeta: null,
        bearings: null,
        scaleBands: null,
      }),
    ).toThrow();
  });
});
