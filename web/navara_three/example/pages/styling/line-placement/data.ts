/**
 * Made-up line shapes chosen to stress line placement: constant curvature, a
 * curvature ramp, repeated inflections, a hairpin, hard corners, a
 * self-intersection, and a straight reference.
 *
 * Each shape is built in metres around its own origin, then laid out on a grid
 * around `CENTER` and converted to degrees.
 */

export const CENTER = { lng: 139.7, lat: 35.62 };

export type CurveOptions = {
  /** Scales the bends of the sine, S-curve, zigzag and hairpin. */
  curviness: number;
  /** Metres between vertices on the smooth shapes. */
  vertexSpacing: number;
  /** Reverse every line, so the placement walks it the other way. */
  reverse: boolean;
};

/** Metres between grid cells. */
const CELL = 2200;
const COLUMNS = 4;
const METERS_PER_DEG_LAT = 111_320;

/** Pure-script names: the shaper has no bidi pass, so an Arabic name mixed
 *  with Latin letters or digits would misplace its word gaps. */
type Names = { en: string; ar: string; ja: string };

type Shape = { name: Names; points: [number, number][] };

/** `n + 1` samples of `f` over `[0, 1]`, with `n` chosen from the arc length. */
const sampleCurve = (
  f: (t: number) => [number, number],
  approxLength: number,
  vertexSpacing: number,
): [number, number][] => {
  const n = Math.max(2, Math.ceil(approxLength / vertexSpacing));
  return Array.from({ length: n + 1 }, (_, i) => f(i / n));
};

const shapes = ({ curviness, vertexSpacing }: CurveOptions): Shape[] => {
  const hairpinRadius = 120 / curviness;
  return [
    {
      name: { en: "Circle Loop", ar: "طريق الدائرة", ja: "環状通り" },
      points: sampleCurve(
        (t) => [
          500 * Math.cos(2 * Math.PI * t),
          500 * Math.sin(2 * Math.PI * t),
        ],
        2 * Math.PI * 500,
        vertexSpacing,
      ),
    },
    {
      name: { en: "Spiral Way", ar: "الطريق الحلزوني", ja: "らせん通り" },
      points: sampleCurve(
        (t) => {
          const a = 3 * 2 * Math.PI * t;
          const r = 80 + (330 * a) / (6 * Math.PI);
          return [r * Math.cos(a), r * Math.sin(a)];
        },
        3 * 2 * Math.PI * 250,
        vertexSpacing,
      ),
    },
    {
      name: { en: "Sine Street", ar: "شارع الموجة", ja: "波形通り" },
      points: sampleCurve(
        (t) => {
          const x = -800 + 1600 * t;
          return [x, 120 * curviness * Math.sin((2 * Math.PI * x) / 500)];
        },
        1600 * (1 + curviness * 0.5),
        vertexSpacing,
      ),
    },
    {
      name: { en: "S Bend Avenue", ar: "جادة المنعطف", ja: "S字大通り" },
      points: sampleCurve(
        (t) => {
          const x = -800 + 1600 * t;
          return [x, 400 * Math.tanh((x * curviness) / 250)];
        },
        2000,
        vertexSpacing,
      ),
    },
    {
      name: { en: "Hairpin Pass", ar: "ممر المنعطف الحاد", ja: "ヘアピン峠" },
      points: [
        [-hairpinRadius, -700],
        ...sampleCurve(
          (t) => [
            -hairpinRadius * Math.cos(Math.PI * t),
            hairpinRadius * Math.sin(Math.PI * t),
          ],
          Math.PI * hairpinRadius,
          vertexSpacing,
        ),
        [hairpinRadius, -700],
      ],
    },
    {
      // Hard corners, no vertices in between: the path samples are chords
      // across each kink.
      name: { en: "Zigzag Lane", ar: "درب متعرج", ja: "ジグザグ小路" },
      points: Array.from({ length: 9 }, (_, i) => [
        -800 + i * 200,
        (i % 2 === 0 ? -1 : 1) * 150 * curviness,
      ]),
    },
    {
      name: { en: "Figure Eight", ar: "طريق الثمانية", ja: "八の字道路" },
      points: sampleCurve(
        (t) => [
          650 * Math.sin(2 * Math.PI * t),
          350 * Math.sin(4 * Math.PI * t),
        ],
        4000,
        vertexSpacing,
      ),
    },
    {
      name: { en: "Straight Road", ar: "الطريق المستقيم", ja: "まっすぐ通り" },
      points: [
        [-700, -500],
        [700, 500],
      ],
    },
  ];
};

export const makeCurves = (options: CurveOptions) => {
  const cosLat = Math.cos((CENTER.lat * Math.PI) / 180);
  const list = shapes(options);
  const rows = Math.ceil(list.length / COLUMNS);
  return {
    type: "FeatureCollection" as const,
    features: list.map(({ name, points }, i) => {
      const originX = ((i % COLUMNS) - (COLUMNS - 1) / 2) * CELL;
      const originY = ((rows - 1) / 2 - Math.floor(i / COLUMNS)) * CELL;
      const coordinates = points.map(([x, y]) => [
        CENTER.lng + (originX + x) / (METERS_PER_DEG_LAT * cosLat),
        CENTER.lat + (originY + y) / METERS_PER_DEG_LAT,
      ]);
      if (options.reverse) coordinates.reverse();
      return {
        type: "Feature" as const,
        properties: {
          index: i,
          name_en: name.en,
          name_ar: name.ar,
          name_ja: name.ja,
        },
        geometry: { type: "LineString" as const, coordinates },
      };
    }),
  };
};
