/**
 * Decides whether a maplibre-gl-js render test only uses style features that
 * docs/src/content/docs/maplibre_style/supported.json marks ✅ or ⚠️. Anything
 * marked ❌ or not listed at all makes the case unsupported, including a
 * source's own properties. The same walk collects the features the case
 * exercises as Playwright tags.
 */

import { latest } from "@maplibre/maplibre-gl-style-spec";

type SupportNode = { status?: string } & Record<string, unknown>;
export type SupportTable = Record<string, SupportNode>;

type StyleLayer = Record<string, unknown> & {
  type: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};
export type RenderTestStyle = Record<string, unknown> & {
  metadata?: { test?: TestMetadata };
  sources?: Record<string, Record<string, unknown> & { type: string }>;
  layers?: StyleLayer[];
};

type SpecProperty = { default?: unknown };
const SPEC = latest as unknown as Record<
  string,
  Record<string, SpecProperty> | undefined
>;

/**
 * maplibre-gl-js `metadata.test`. render.test.ts applies the typed options,
 * `operations` are limited to HARNESS_OPERATIONS, and a case using any of
 * UNSUPPORTED_TEST_OPTIONS is skipped. The rest (notes such as `description`,
 * upstream pass criteria such as `allowed`) do not change the rendering.
 */
type TestMetadata = Record<string, unknown> & {
  width?: number;
  height?: number;
  pixelRatio?: number;
  threshold?: number;
  operations?: [string, ...unknown[]][];
};
/** The harness renders the initial style only. */
const HARNESS_OPERATIONS = new Set(["wait", "idle"]);
/**
 * Options whose expected images Navara cannot match: overlays MapLibre draws
 * on top of the map, and MapLibre rendering settings.
 */
const UNSUPPORTED_TEST_OPTIONS = [
  "debug",
  "collisionDebug",
  "showOverdrawInspector",
  "showPadding",
  "addFakeCanvas",
  "fadeDuration",
  "crossSourceCollisions",
  "localIdeographFontFamily",
  "terrainSkirtLength",
];

function child(node: unknown, key: string): SupportNode | undefined {
  return node && typeof node === "object"
    ? ((node as Record<string, unknown>)[key] as SupportNode | undefined)
    : undefined;
}

function isSupported(node: SupportNode | undefined): boolean {
  return !!node?.status && !node.status.startsWith("❌");
}

export type StyleClassification = {
  /** Why the style is unsupported; empty when every feature is supported. */
  reasons: string[];
  /**
   * Layer types, paint/layout properties, source types, and expression
   * operators the style uses, so that after fixing one feature,
   * `-g @<feature>` re-runs just the cases using it.
   */
  tags: string[];
};

export function classifyStyle(
  style: RenderTestStyle,
  support: SupportTable,
): StyleClassification {
  const reasons = new Set<string>();
  const features = new Set<string>();

  const test = style.metadata?.test ?? {};
  for (const option of UNSUPPORTED_TEST_OPTIONS) {
    if (option in test) reasons.add(`test option: ${option}`);
  }
  for (const [op] of test.operations ?? []) {
    if (!HARNESS_OPERATIONS.has(op)) reasons.add(`operation: ${op}`);
  }

  for (const [key, value] of Object.entries(style)) {
    const section = support[key];
    if (!isSupported(child(support.root, key))) {
      reasons.add(`root: ${key}`);
    } else if (
      section &&
      !section.status &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      // Sections such as `terrain` and `sky` list their properties.
      for (const prop of Object.keys(value)) {
        if (!isSupported(child(section, prop))) {
          reasons.add(`${key}: ${prop}`);
        }
      }
    }
  }

  for (const source of Object.values(style.sources ?? {})) {
    features.add(source.type);
    const node = child(support.source, source.type);
    // e.g. `mvt` or `mlt` for vector, `mapbox` or `terrarium` for raster-dem.
    const encoding =
      source.encoding ??
      SPEC[`source_${source.type.replace("-", "_")}`]?.encoding?.default;
    if (!isSupported(node)) {
      reasons.add(`source: ${source.type}`);
    } else {
      if (
        encoding !== undefined &&
        !isSupported(child(child(node, "encoding"), String(encoding)))
      ) {
        reasons.add(`source: ${source.type} encoding ${String(encoding)}`);
      }
      // Properties the style sets on the source. `type` and `encoding` are
      // judged above.
      const sourceSpec = SPEC[`source_${source.type.replace("-", "_")}`];
      for (const [prop, value] of Object.entries(source)) {
        if (prop === "type" || prop === "encoding") continue;
        // A property at its spec default is the same as leaving it out.
        if (
          JSON.stringify(sourceSpec?.[prop]?.default) === JSON.stringify(value)
        ) {
          continue;
        }
        if (!isSupported(child(child(node, "properties"), prop))) {
          reasons.add(`source ${source.type}: ${prop}`);
        }
      }
    }
  }

  // A leading string is only an operator if the table knows it; otherwise the
  // array is data (e.g. a `text-font` stack or `match` labels). Data strings
  // are collected as features too; only operator-like names become tags.
  const checkExpression = (value: unknown) => {
    for (const op of collectOperators(value)) {
      features.add(op);
      const node = child(support.expression, op);
      if (node && !isSupported(node)) reasons.add(`expression: ${op}`);
    }
  };

  for (const layer of style.layers ?? []) {
    features.add(layer.type);
    const layerSupport = child(support.layer, layer.type);
    const layerSupported = isSupported(layerSupport);
    if (!layerSupported) reasons.add(`layer: ${layer.type}`);
    // Keys outside the spec, e.g. the legacy `ref`.
    for (const key of Object.keys(layer)) {
      if (!SPEC.layer?.[key]) reasons.add(`layer key: ${key}`);
    }
    for (const section of ["paint", "layout"] as const) {
      for (const [prop, value] of Object.entries(layer[section] ?? {})) {
        features.add(prop);
        if (
          layerSupported &&
          !isSupported(child(child(layerSupport, section), prop))
        ) {
          reasons.add(`${layer.type} ${section}: ${prop}`);
        }
        checkExpression(value);
      }
    }
    checkExpression(layer.filter);
  }

  return {
    reasons: [...reasons],
    tags: [...features]
      .filter((f) => /^[a-z][a-z0-9-]*$/.test(f))
      .sort()
      .map((f) => `@${f}`),
  };
}

/**
 * Leading strings of every array in an expression. Legacy functions and
 * filters (e.g. `{stops}`, `["!in", ...]`) are migrated to expressions by the
 * plugin, so only operators the table lists are judged.
 */
function collectOperators(value: unknown, out = new Set<string>()) {
  if (Array.isArray(value)) {
    const [op, ...args] = value as unknown[];
    if (typeof op === "string") {
      out.add(op);
      if (op === "literal") return out;
    }
    args.forEach((arg) => collectOperators(arg, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectOperators(v, out));
  }
  return out;
}
