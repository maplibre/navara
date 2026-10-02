import { describe, expect, it } from "vitest";

import {
  LINE_LABEL_FIT_STRIDE,
  LINE_LABEL_STRIDE,
  PATH_META_STRIDE,
  SCALE_BAND_STRIDE,
  findRepeatedLabels,
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

function label(over: Partial<PackableLabel> = {}): PackableLabel {
  return {
    slot: 0,
    instanceIndex: 0,
    anchor: new Float64Array([1, 2, 3]),
    addHeight: 0,
    widthEm: 4,
    heightEm: 1,
    minYEm: 0,
    maxYEm: 1,
    maxWordHalfEm: 1.5,
    fontSize: 10,
    ...over,
  };
}

const options = {
  sizeInMeters: true,
  maxAngleDeg: 45,
  keepUpright: true,
  center: [0.5, 0] as const,
  lineOffset: 0,
  readFlip: () => false,
  readFlatFacing: () => true,
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
      scaleBands: null,
    };

    const fit = packLineLabelFits([label({ instanceIndex: 2 })], p, options);
    expect(fit[7]).toBeCloseTo(7, 5);
  });

  it("treats a missing meta array as no usable line", () => {
    const p: LinePath = {
      samples: new Float32Array(SAMPLES * 2),
      stride: SAMPLES * 2,
      meta: null,
      bearings: null,
      scaleBands: null,
    };
    expect(packLineLabelFits([label()], p, options)[7]).toBe(0);
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
    const l = label({ widthEm: 7 });
    const offCentre = { ...options, center: [0, 0] as const };
    expect(packLineLabelFits([l], p, offCentre)[10]).toBe(7);
    expect(packLineLabels([l], p, offCentre).labels[21]).toBe(7);
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
  // The shader lays text over [-cx·w, (1 - cx)·w] around the anchor, so an
  // off-centre anchor leaves one side needing more line than half the width.
  it("fits the longer side of an off-centre label", () => {
    const p = path(10, 500);
    const at = (cx: number) => ({ ...options, center: [cx, 0] as const });
    for (const [cx, reach] of [
      [0.5, 2],
      [0, 4],
      [-0.5, 6],
    ]) {
      expect(packLineLabelFits([label()], p, at(cx))[4]).toBe(reach);
      expect(packLineLabels([label()], p, at(cx)).labels[4]).toBe(reach);
    }
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

  it("resolves the facing per label", () => {
    const p = path(10, 500);
    const labels = [label({ slot: 0 }), label({ slot: 1 })];
    const packed = packLineLabels(labels, p, {
      ...options,
      readFlatFacing: (slot) => slot === 1,
    }).labels;
    expect(packed[18]).toBe(0);
    expect(packed[LINE_LABEL_STRIDE + 18]).toBe(1);
  });
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
      pathMeta: null,
      bearings: null,
      scaleBands: null,
    });
    expect(lifted?.samples).toBe(samples);
    expect(lifted?.stride).toBe(4);
  });
});
