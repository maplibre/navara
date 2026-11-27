// Differential tests: RustStyleEngine (maplibre-expr via WASM) against
// @maplibre/maplibre-gl-style-spec. Longer run: FC_NUM_RUNS=20000 pnpm exec vitest run <this file> --testTimeout=0
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import {
  Color,
  createPropertyExpression,
  featureFilter,
  latest,
  migrate,
  type FilterSpecification,
  type StylePropertySpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { CompiledExpression, initSync } from "@navaramap/engine";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RustStyleEngine } from "./RustStyleEngine";
import {
  expressionArbs,
  fcParams,
  propertiesArb,
  propertyExpressionArb,
  zoomArb,
} from "./testing/expressionArbitraries";
import type { PropertySpec } from "./types";

const NUMBER_SPEC = latest.paint_circle["circle-radius"] as PropertySpec;
const COLOR_SPEC = latest.paint_circle["circle-color"] as PropertySpec;

type Outcome = { rejected: true } | { rejected: false; value: unknown };

/**
 * Colors as straight RGBA. Of strings, only a color property's default is
 * parsed: RustStyleEngine falls back to `spec.default` as given.
 */
function normalize(value: unknown, spec: PropertySpec): unknown {
  if (
    spec.type === "color" &&
    typeof value === "string" &&
    value === spec.default
  ) {
    const parsed = Color.parse(value);
    if (parsed) return normalize(parsed, spec);
  }
  if (value instanceof Color) return normalize(rgbaOf(value), spec);
  if (Array.isArray(value)) return value.map((v) => normalize(v, spec));
  if (typeof value === "number") return Number.isNaN(value) ? "NaN" : value;
  if (value && typeof value === "object") {
    const { r, g, b, a } = value as Record<string, number>;
    return a === 0 ? { a: 0 } : { r, g, b, a };
  }
  return value;
}

/** Deep equality with a tolerance for libm vs V8 float differences. */
function close(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return a === b || Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
  }
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => close(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return close(ka, kb) && ka.every((k) => close(ra[k], rb[k]));
  }
  return a === b;
}

function expectSame(actual: Outcome, expected: Outcome): void {
  expect(
    close(actual, expected),
    `actual ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  ).toBe(true);
}

function rgbaOf(color: Color): { r: number; g: number; b: number; a: number } {
  const [r, g, b, a] = color.rgb;
  return { r, g, b, a };
}

function oracle(
  expr: unknown,
  spec: PropertySpec,
  properties: Record<string, unknown>,
  zoom: number,
): Outcome {
  const parsed = createPropertyExpression(
    expr,
    "paint",
    spec as StylePropertySpecification,
  );
  if (parsed.result === "error") return { rejected: true };
  const value = parsed.value.evaluate({ zoom }, {
    type: "Point",
    properties,
    geometry: [],
  } as never);
  return { rejected: false, value: normalize(value, spec) };
}

const engine = new RustStyleEngine();

function underTest(
  expr: unknown,
  spec: PropertySpec,
  properties: Record<string, unknown>,
  zoom: number,
): Outcome {
  let fn: (ctx: {
    properties: Record<string, unknown>;
    zoom: number;
  }) => unknown;
  try {
    fn = engine.createValueFn(expr as never, spec);
  } catch {
    return { rejected: true };
  }
  return { rejected: false, value: normalize(fn({ properties, zoom }), spec) };
}

/** `underTest` with every property of the bag named as required. */
function underTestWithAllProperties(
  expr: unknown,
  spec: PropertySpec,
  properties: Record<string, unknown>,
  zoom: number,
): Outcome {
  const spy = vi
    .spyOn(CompiledExpression.prototype, "getRequiredProperties")
    .mockReturnValue(Object.keys(properties) as never);
  try {
    return underTest(expr, spec, properties, zoom);
  } finally {
    spy.mockRestore();
  }
}

function filterOutcome<C>(
  create: () => (ctx: C) => boolean,
  ctx: C,
): boolean | "rejected" {
  let filter: (ctx: C) => boolean;
  try {
    filter = create();
  } catch {
    return "rejected";
  }
  return filter(ctx);
}

beforeAll(() => {
  const dir = dirname(fileURLToPath(import.meta.url));
  initSync({
    module: readFileSync(
      join(dir, "../../../wasm/navara_engine/navara_wasm_bg.wasm"),
    ),
  });
  // Both engines log evaluation errors and fall back to the default.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

describe("RustStyleEngine matches maplibre-gl-style-spec on generated expressions", () => {
  const arbs = expressionArbs({ dynamicGet: false });

  it.each([
    ["number", NUMBER_SPEC, propertyExpressionArb(arbs.num, true)],
    ["number step", NUMBER_SPEC, propertyExpressionArb(arbs.num, false)],
    ["color", COLOR_SPEC, propertyExpressionArb(arbs.color, true)],
  ] as const)("%s properties", (_name, spec, exprArb) => {
    fc.assert(
      fc.property(exprArb, propertiesArb, zoomArb, (expr, properties, zoom) => {
        expectSame(
          underTest(expr, spec, properties, zoom),
          oracle(expr, spec, properties, zoom),
        );
      }),
      fcParams(300),
    );
  });

  it("filters", () => {
    fc.assert(
      // `case` keeps a literal comparison from reading as a legacy filter.
      fc.property(
        arbs.bool.map((b) => ["case", b, true, false]),
        propertiesArb,
        zoomArb,
        (expr, properties, zoom) => {
          const feature = { type: "Point", properties, geometry: [] } as never;
          // The plugin migrates legacy filters (`["in", "key", ...]`) first.
          const migrated = migrate({
            version: 8,
            sources: {},
            layers: [
              {
                id: "l",
                type: "circle",
                source: "s",
                filter: expr as FilterSpecification,
              },
            ],
          }).layers[0] as { filter: unknown };
          expect(
            filterOutcome(
              () =>
                engine.createFilter(
                  migrated.filter as never,
                  "circle",
                  "Point",
                ),
              { properties, zoom },
            ),
          ).toBe(
            filterOutcome(() => {
              const { filter } = featureFilter(
                expr as FilterSpecification,
                "filter",
              );
              return () => filter({ zoom }, feature);
            }, undefined),
          );
        },
      ),
      fcParams(300),
    );
  });
});

// standard: MapLibre Style Spec, expressions (get, has, properties)
// ref: https://maplibre.org/maplibre-style-spec/expressions/
describe("property access by a computed name", () => {
  it("computed property names see every property", () => {
    const arbs = expressionArbs({ dynamicGet: true });
    fc.assert(
      fc.property(
        arbs.num,
        propertiesArb,
        zoomArb,
        (expr, properties, zoom) => {
          expectSame(
            underTest(expr, NUMBER_SPEC, properties, zoom),
            oracle(expr, NUMBER_SPEC, properties, zoom),
          );
        },
      ),
      fcParams(300),
    );
  });

  it.each([
    [
      "a computed get next to a literal get",
      ["number", ["get", ["get", "k"]], 0],
    ],
    [
      "a get keyed by a let variable",
      ["let", "key", ["get", "k"], ["number", ["get", ["var", "key"]], 0]],
    ],
    ["a computed has", ["case", ["has", ["get", "k"]], 1, 0]],
    [
      "properties next to a literal get",
      [
        "+",
        ["length", ["to-string", ["properties"]]],
        ["number", ["get", "k"], 0],
      ],
    ],
    [
      "a get from an object next to a literal get",
      ["number", ["get", ["get", "k"], ["properties"]], 0],
    ],
    [
      "a literal get on properties next to a literal get",
      [
        "+",
        ["number", ["get", "v", ["properties"]], 0],
        ["length", ["string", ["get", "k"], ""]],
      ],
    ],
    [
      "a literal has on properties",
      ["case", ["has", "v", ["properties"]], 1, 0],
    ],
  ])("%s", (_name, expr) => {
    const properties = { k: "v", v: 3 };
    expectSame(
      underTest(expr, NUMBER_SPEC, properties, 0),
      oracle(expr, NUMBER_SPEC, properties, 0),
    );
  });

  // user: optimization-preserves-result
  it.each([
    ["number", NUMBER_SPEC, expressionArbs({ dynamicGet: true }).num],
    ["color", COLOR_SPEC, expressionArbs({ dynamicGet: true }).color],
  ] as const)(
    "passing only the required properties keeps the %s result",
    (_name, spec, inner) => {
      fc.assert(
        fc.property(
          propertyExpressionArb(inner, true),
          propertiesArb,
          zoomArb,
          (expr, properties, zoom) => {
            expectSame(
              underTest(expr, spec, properties, zoom),
              underTestWithAllProperties(expr, spec, properties, zoom),
            );
          },
        ),
        fcParams(300),
      );
    },
  );

  // user: optimization-preserves-result
  it("an expression with only literal names gets only those properties", () => {
    const expr = [
      "+",
      ["number", ["get", "n1"], 0],
      ["case", ["has", "x", ["properties"]], 1, 0],
    ];
    const required = new CompiledExpression(
      expr,
      "number",
    ).getRequiredProperties();
    expect([...(required ?? [])].sort()).toEqual(["n1", "x"]);

    const evaluate = vi.spyOn(CompiledExpression.prototype, "evaluate");
    try {
      engine.createValueFn(
        expr as never,
        NUMBER_SPEC,
      )({
        properties: { n1: 2, x: true, unused: "a" },
        zoom: 0,
      });
      expect(Object.keys(evaluate.mock.calls[0][0] as object).sort()).toEqual([
        "n1",
        "x",
      ]);
    } finally {
      evaluate.mockRestore();
    }
  });
});

describe("known divergences from maplibre-gl-style-spec", () => {
  // The spec returns the property default for a NaN result; the Rust engine
  // only replaces null, so NaN reaches the adapters.
  it.fails("a NaN result falls back to the default", () => {
    expectSame(
      underTest(["sqrt", -1], NUMBER_SPEC, {}, 0),
      oracle(["sqrt", -1], NUMBER_SPEC, {}, 0),
    );
  });

  // The spec returns a single-stop curve's output without evaluating the
  // input; maplibre-expr evaluates it and fails on a missing property.
  it.fails("a single-stop interpolate ignores its input", () => {
    const expr = ["interpolate", ["linear"], ["get", "x"], 0, 1];
    expectSame(
      underTest(expr, NUMBER_SPEC, {}, 0),
      oracle(expr, NUMBER_SPEC, {}, 0),
    );
  });

  // maplibre-expr's typecheck does not pass the expected number type from
  // `+`/`-`/`*`/`min`/`max` arguments into an `interpolate`, so a first
  // output of type value (`get`, `coalesce`) is "not interpolatable" and the
  // whole property falls back to its default.
  it.fails("an interpolate with a get output inside + compiles", () => {
    const expr = [
      "+",
      1,
      ["interpolate", ["linear"], 0, 0, ["get", "x"], 1, 0],
    ];
    expectSame(
      underTest(expr, NUMBER_SPEC, { x: 2 }, 0),
      oracle(expr, NUMBER_SPEC, { x: 2 }, 0),
    );
  });

  // A color interpolated in HCL or Lab and used as a stop of another
  // interpolation comes out differently from the same color given as a
  // literal; the spec's result differs from maplibre-expr's.
  it.fails(
    "an HCL-interpolated color as a stop of an HCL interpolation",
    () => {
      const expr = [
        "interpolate-hcl",
        ["linear"],
        0.5,
        0,
        "red",
        1,
        ["interpolate-hcl", ["linear"], 5, 0, "blue", 10, "red"],
      ];
      expectSame(
        underTest(expr, COLOR_SPEC, {}, 0),
        oracle(expr, COLOR_SPEC, {}, 0),
      );
    },
  );

  // maplibre-expr folds `min`/`max` with f64::min/max, which drop NaN;
  // the spec's Math.min/max propagate it.
  it.fails("min propagates NaN", () => {
    const expr = ["case", ["==", ["min", 0, ["ln", ["get", "x"]]], 0], 1, 2];
    expectSame(
      underTest(expr, NUMBER_SPEC, { x: -1 }, 0),
      oracle(expr, NUMBER_SPEC, { x: -1 }, 0),
    );
  });
});

/** Edge cases of the spec's semantics, with the style-spec result as the oracle. */
const CURATED: [
  string,
  unknown,
  PropertySpec,
  Record<string, unknown>?,
  number?,
][] = [
  ["round half away from zero", ["round", -2.5], NUMBER_SPEC],
  ["remainder sign follows dividend", ["%", -7, 3], NUMBER_SPEC],
  ["division by zero", ["/", 1, 0], NUMBER_SPEC],
  ["fractional power", ["^", 2, 0.5], NUMBER_SPEC],
  ["to-number trims whitespace", ["to-number", " 12 "], NUMBER_SPEC],
  ["to-number of empty string", ["to-number", ""], NUMBER_SPEC],
  ["to-number of hex", ["to-number", "0x10"], NUMBER_SPEC],
  ["to-number fallback", ["to-number", "abc", 7], NUMBER_SPEC],
  ["length counts UTF-16 units", ["length", "😀a"], NUMBER_SPEC],
  ["index-of in UTF-16 units", ["index-of", "b", "😀ab"], NUMBER_SPEC],
  ["to-string of 1e21", ["length", ["to-string", 1e21]], NUMBER_SPEC],
  ["to-string of 1/3", ["length", ["to-string", ["/", 1, 3]]], NUMBER_SPEC],
  ["get asserts the property type", ["get", "x"], NUMBER_SPEC, { x: "5" }],
  [
    "number assertion fallback",
    ["number", ["get", "x"], 9],
    NUMBER_SPEC,
    { x: "5" },
  ],
  ["missing property", ["get", "x"], NUMBER_SPEC, {}],
  [
    "property named __proto__",
    ["number", ["get", "__proto__"], 0],
    NUMBER_SPEC,
    JSON.parse('{"__proto__": 3}') as Record<string, unknown>,
  ],
  ["null property", ["get", "x"], NUMBER_SPEC, { x: null }],
  [
    "coalesce skips null",
    ["coalesce", ["get", "a"], ["get", "b"], 1],
    NUMBER_SPEC,
    { a: null, b: 2 },
  ],
  [
    "match does not coerce",
    ["match", ["get", "x"], 2, 1, 0],
    NUMBER_SPEC,
    { x: "2" },
  ],
  [
    "match label list",
    ["match", ["get", "x"], [1, 2], 1, 0],
    NUMBER_SPEC,
    { x: 2 },
  ],
  ["step at a stop", ["step", ["zoom"], 0, 5, 1], NUMBER_SPEC, {}, 5],
  ["step below a stop", ["step", ["zoom"], 0, 5, 1], NUMBER_SPEC, {}, 4.9999],
  [
    "exponential interpolate",
    ["interpolate", ["exponential", 2], ["zoom"], 0, 0, 10, 100],
    NUMBER_SPEC,
    {},
    5,
  ],
  [
    "cubic-bezier interpolate",
    [
      "interpolate",
      ["cubic-bezier", 0.42, 0, 0.58, 1],
      ["zoom"],
      0,
      0,
      10,
      100,
    ],
    NUMBER_SPEC,
    {},
    3,
  ],
  [
    "interpolate clamps",
    ["interpolate", ["linear"], ["zoom"], 5, 1, 10, 2],
    NUMBER_SPEC,
    {},
    22,
  ],
  ["bare zoom is rejected", ["zoom"], NUMBER_SPEC],
  [
    "nested zoom curve is rejected",
    ["+", 1, ["interpolate", ["linear"], ["zoom"], 0, 0, 1, 1]],
    NUMBER_SPEC,
  ],
  [
    "zoom inside let is rejected",
    ["let", "z", ["zoom"], ["var", "z"]],
    NUMBER_SPEC,
  ],
  [
    "comparing number to string is rejected",
    ["case", ["==", 1, "1"], 1, 0],
    NUMBER_SPEC,
  ],
  ["out-of-range rgba literal is rejected", ["rgba", 300, 0, 0, 1], COLOR_SPEC],
  [
    "color from property string",
    ["get", "x"],
    COLOR_SPEC,
    { x: "rgba(255,0,0,0.5)" },
  ],
  ["unparsable color property", ["get", "x"], COLOR_SPEC, { x: "nope" }],
  ["hsl color", ["to-color", "hsl(120, 100%, 25%)"], COLOR_SPEC],
  [
    "premultiplied rgb interpolation",
    ["interpolate", ["linear"], ["zoom"], 0, "rgba(255,0,0,0)", 10, "blue"],
    COLOR_SPEC,
    {},
    5,
  ],
  [
    "hcl interpolation",
    ["interpolate-hcl", ["linear"], ["zoom"], 0, "red", 10, "blue"],
    COLOR_SPEC,
    {},
    5,
  ],
  [
    "lab interpolation",
    ["interpolate-lab", ["linear"], ["zoom"], 0, "red", 10, "blue"],
    COLOR_SPEC,
    {},
    5,
  ],
  ["transparent keyword", "transparent", COLOR_SPEC],
];

describe("curated spec edge cases", () => {
  it.each(CURATED)("%s", (_name, expr, spec, properties = {}, zoom = 0) => {
    expectSame(
      underTest(expr, spec, properties, zoom),
      oracle(expr, spec, properties, zoom),
    );
  });
});

describe("robustness", () => {
  it("evaluation never throws on arbitrary feature properties", () => {
    const arbs = expressionArbs();
    fc.assert(
      fc.property(
        propertyExpressionArb(arbs.num, true),
        fc.dictionary(
          fc.constantFrom("n1", "n2", "s1", "s2", "b1", "c1", "k"),
          fc.jsonValue({ maxDepth: 2 }),
        ),
        zoomArb,
        (expr, properties, zoom) => {
          let fn: (ctx: {
            properties: Record<string, unknown>;
            zoom: number;
          }) => unknown;
          try {
            fn = engine.createValueFn(expr as never, NUMBER_SPEC);
          } catch {
            return;
          }
          expect(typeof fn({ properties, zoom })).toBe("number");
        },
      ),
      fcParams(200),
    );
  });

  it("createFilter rejects what the spec rejects, at creation", () => {
    const invalid = fc.constantFrom<unknown[]>(
      ["==", ["get", "a"]],
      ["not-an-op", 1],
      ["<", ["literal", [1]], 2],
      ["get"],
    );
    fc.assert(
      fc.property(invalid, (expr) => {
        expect(() =>
          featureFilter(expr as FilterSpecification, "filter"),
        ).toThrow();
        expect(() =>
          engine.createFilter(expr as never, "circle", "Point"),
        ).toThrow();
      }),
      fcParams(20),
    );
  });
});
