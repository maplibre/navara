/**
 * fast-check arbitraries for well-typed MapLibre expressions and the feature
 * properties they read, for differential tests against
 * `@maplibre/maplibre-gl-style-spec`.
 */

import fc from "fast-check";

/** Run settings; override with FC_SEED / FC_NUM_RUNS for longer runs. */
export function fcParams(numRuns: number): fc.Parameters<unknown> {
  return {
    seed: Number(process.env.FC_SEED ?? 42),
    numRuns: Number(process.env.FC_NUM_RUNS ?? numRuns),
  };
}

const NUMBER_KEYS = ["n1", "n2"] as const;
const STRING_KEYS = ["s1", "s2"] as const;
const COLORS = [
  "red",
  "#00ff0080",
  "rgba(0, 0, 255, 0.5)",
  "hsl(120, 50%, 50%)",
  "transparent",
];
const STRINGS = ["", "a", "B", "ab", "1", "-2.5", " 3 ", "x,y", "é", "😀b"];

const smallNumber = fc.oneof(
  fc.integer({ min: -10, max: 10 }),
  fc.integer({ min: -10000, max: 10000 }).map((n) => n / 100),
);

/**
 * Property bags: typed values most of the time, mistyped or missing values
 * otherwise, so assertions and coercions both run.
 */
export const propertiesArb: fc.Arbitrary<Record<string, unknown>> = fc.record(
  {
    n1: fc.oneof(
      { weight: 4, arbitrary: smallNumber },
      fc.constantFrom("2", null, true),
    ),
    n2: fc.oneof(
      { weight: 4, arbitrary: smallNumber },
      fc.constantFrom("x", null),
    ),
    s1: fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(...STRINGS) },
      smallNumber,
    ),
    s2: fc.constantFrom(...STRINGS),
    b1: fc.oneof(
      { weight: 4, arbitrary: fc.boolean() },
      fc.constantFrom(0, "true"),
    ),
    c1: fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(...COLORS) },
      fc.constantFrom("nope", 3),
    ),
  },
  { requiredKeys: [] },
);

export const zoomArb = fc.oneof(
  fc.integer({ min: 0, max: 22 }),
  fc.integer({ min: 0, max: 2200 }).map((z) => z / 100),
);

type Expr = unknown;

/** Ascending stop inputs for `step` / `interpolate`. */
const stopInputs = fc
  .uniqueArray(fc.integer({ min: -20, max: 40 }), {
    minLength: 1,
    maxLength: 3,
  })
  .map((xs) => [...xs].sort((a, b) => a - b));

/**
 * Typed expression grammar. `dynamicGet` adds property access by a computed
 * name and `["properties"]`, which MapLibre resolves at evaluation time.
 * Shapes covered by an `it.fails` marker in RustStyleEngine.differential.test.ts
 * are not generated.
 */
export function expressionArbs(options: { dynamicGet?: boolean } = {}) {
  const { dynamicGet = true } = options;
  // "a single-stop interpolate ignores its input"
  const curveStops = stopInputs.filter((s) => s.length > 1);
  // "an interpolate with a get output inside + compiles"
  const typed = (e: Expr) => (Array.isArray(e) ? ["number", e, 0] : e);
  return fc.letrec<{ num: Expr; str: Expr; bool: Expr; color: Expr }>((tie) => {
    const num = tie("num");
    const str = tie("str");
    const bool = tie("bool");
    const color = tie("color");
    const getNumber = fc.constantFrom(...NUMBER_KEYS).map((k) => ["get", k]);
    const getString = fc.constantFrom(...STRING_KEYS).map((k) => ["get", k]);
    const dynamic: fc.Arbitrary<Expr>[] = dynamicGet
      ? [
          fc
            .constantFrom("1", "2")
            .map((d) => ["number", ["get", ["concat", "n", d]], 0]),
          fc.constant(["length", ["to-string", ["properties"]]]),
        ]
      : [];
    return {
      num: fc.oneof(
        { depthSize: "small", withCrossShrink: true },
        smallNumber,
        getNumber,
        getNumber.map((g) => ["number", g, -1]),
        fc
          .constantFrom(...NUMBER_KEYS)
          .map((k) => ["number", ["get", k, ["properties"]], -1]),
        ...dynamic,
        fc
          .tuple(fc.constantFrom("+", "-", "*", "min", "max"), num, num)
          .map(([op, a, b]) => [op, a, b]),
        // NaN results ("a NaN result falls back to the default", "min
        // propagates NaN") and libm-rounded ops (`^`, `ln`) are curated cases.
        fc
          .tuple(fc.constantFrom("/", "%"), num, num)
          .map(([op, a, b]) => [op, a, ["+", 0.5, ["abs", b]]]),
        fc
          .tuple(fc.constantFrom("abs", "round", "floor", "ceil", "-"), num)
          .map(([op, a]) => [op, a]),
        fc.tuple(str, num).map(([s, d]) => ["to-number", s, d]),
        str.map((s) => ["length", s]),
        fc.tuple(str, str).map(([a, b]) => ["index-of", a, b]),
        fc.tuple(bool, num, num).map(([c, a, b]) => ["case", c, a, b]),
        fc.tuple(getNumber, num, num).map(([g, a, b]) => ["coalesce", g, a, b]),
        fc
          .tuple(
            fc.constantFrom("n1", "n2"),
            fc.integer({ min: -3, max: 3 }),
            num,
            num,
          )
          .map(([k, label, a, b]) => ["match", ["get", k], label, a, b]),
        fc
          .tuple(
            num,
            num,
            stopInputs,
            fc.array(num, { minLength: 3, maxLength: 3 }),
          )
          .map(([input, out0, stops, outs]) => [
            "step",
            input,
            out0,
            ...stops.flatMap((s, i) => [s, outs[i]]),
          ]),
        fc
          .tuple(
            num,
            curveStops,
            fc.array(num, { minLength: 3, maxLength: 3 }),
            fc.constantFrom(["linear"], ["exponential", 2]),
          )
          .map(([input, stops, outs, kind]) => [
            "interpolate",
            kind,
            input,
            ...stops.flatMap((s, i) => [s, typed(outs[i])]),
          ]),
        fc
          .tuple(num, num)
          .map(([v, b]) => ["let", "v", v, ["+", ["var", "v"], b]]),
      ),
      str: fc.oneof(
        { depthSize: "small", withCrossShrink: true },
        fc.constantFrom(...STRINGS),
        getString.map((g) => ["string", g, "?"]),
        fc.oneof(num, bool, color).map((v) => ["to-string", v]),
        fc.tuple(str, str).map(([a, b]) => ["concat", a, b]),
        fc
          .tuple(fc.constantFrom("upcase", "downcase"), str)
          .map(([op, a]) => [op, a]),
        fc
          .tuple(str, fc.integer({ min: -2, max: 3 }))
          .map(([s, i]) => ["slice", s, i]),
        fc.tuple(bool, str, str).map(([c, a, b]) => ["case", c, a, b]),
        fc.tuple(getString, str).map(([g, s]) => ["coalesce", g, s]),
      ),
      bool: fc.oneof(
        { depthSize: "small", withCrossShrink: true },
        fc.boolean(),
        fc.constantFrom("n1", "s1", "b1", "zz").map((k) => ["has", k]),
        fc.constantFrom("n1", "zz").map((k) => ["has", k, ["properties"]]),
        fc.constant(["boolean", ["get", "b1"], false]),
        fc
          .tuple(fc.constantFrom("==", "!=", "<", "<=", ">", ">="), num, num)
          .map(([op, a, b]) => [op, a, b]),
        fc
          .tuple(fc.constantFrom("==", "!=", "<", ">="), str, str)
          .map(([op, a, b]) => [op, a, b]),
        bool.map((b) => ["!", b]),
        fc
          .tuple(fc.constantFrom("all", "any"), bool, bool)
          .map(([op, a, b]) => [op, a, b]),
        fc.oneof(num, str).map((v) => ["to-boolean", v]),
        fc.tuple(str, str).map(([a, b]) => ["in", a, b]),
      ),
      color: fc.oneof(
        { depthSize: "small", withCrossShrink: true },
        fc.constantFrom(...COLORS),
        fc.constant(["to-color", ["get", "c1"], "black"]),
        fc
          .tuple(
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            num,
            fc.integer({ min: 0, max: 100 }).map((a) => a / 100),
          )
          .map(([r, g, b, a]) => [
            "rgba",
            r,
            g,
            ["min", 255, ["max", 0, b]],
            a,
          ]),
        fc.tuple(bool, color, color).map(([c, a, b]) => ["case", c, a, b]),
        fc
          .tuple(
            fc.constantFrom(
              "interpolate",
              "interpolate-hcl",
              "interpolate-lab",
            ),
            num,
            color,
            color,
          )
          // "an HCL-interpolated color as a stop of an HCL interpolation"
          .filter(([, , a, b]) => !anyColorSpaceCurve([a, b]))
          .map(([op, input, a, b]) => [op, ["linear"], input, 0, a, 10, b]),
      ),
    };
  });
}

function anyColorSpaceCurve(exprs: Expr[]): boolean {
  return /"interpolate-(hcl|lab)"/.test(JSON.stringify(exprs));
}

/**
 * A property expression: optionally wrapped in a top-level zoom curve, the
 * only place MapLibre allows `["zoom"]`.
 */
export function propertyExpressionArb(
  inner: fc.Arbitrary<Expr>,
  interpolatable: boolean,
): fc.Arbitrary<Expr> {
  const zoomCurve = fc
    .tuple(
      stopInputs.map((s) => s.map((z) => Math.abs(z) % 23)),
      // A `step` takes the first as the output below the first stop.
      fc.array(inner, { minLength: 4, maxLength: 4 }),
    )
    .filter(([stops]) => new Set(stops).size === stops.length)
    // "an HCL-interpolated color as a stop of an HCL interpolation"
    .filter(([, outs]) => !interpolatable || !anyColorSpaceCurve(outs))
    .map(([stops, outs]) => {
      const sorted = [...stops].sort((a, b) => a - b);
      return interpolatable
        ? [
            "interpolate",
            ["linear"],
            ["zoom"],
            ...sorted.flatMap((s, i) => [s, outs[i + 1]]),
          ]
        : [
            "step",
            ["zoom"],
            outs[0],
            ...sorted.flatMap((s, i) => [s, outs[i + 1]]),
          ];
    });
  return fc.oneof({ weight: 3, arbitrary: inner }, zoomCurve);
}
