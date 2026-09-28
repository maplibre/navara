/**
 * Curated gallery model for the refreshed examples.
 *
 * Each example ships a `meta.ts` next to its `main.ts`. The gallery index
 * collects every `meta.ts` via `import.meta.glob` and groups them into the
 * display sections declared here. Display section is intentionally decoupled
 * from the directory: e.g. `gis/*` lives under "2D" / "2.5D", `mesh/*` under
 * "3D", and `weather/*` + `effect/*` fold into the "lighting-effect" section.
 * Getting Started holds only the single-example onboarding track.
 */

/** Display section keys, in gallery order. */
export const SECTION_KEYS = [
  "getting-started",
  "2d",
  "2.5d",
  "3d",
  "basemap",
  "terrain",
  "tiles-3d",
  "styling",
  "interaction",
  "lighting-effect",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/** Languages the gallery UI supports, in toggle order. */
export const SUPPORTED_LANGS = ["en", "ja"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = "en";

/**
 * A localized string: either a bare string (applies to every language) or
 * per-language variants. Authoring in a single language is fine — it becomes
 * the fallback for the others.
 */
export type Localized = string | Partial<Record<Lang, string>>;

/**
 * Resolve a {@link Localized} value for `lang`, falling back to the default
 * language, then to whatever variant is present.
 */
export const localize = (text: Localized | undefined, lang: Lang): string => {
  if (text == null) return "";
  if (typeof text === "string") return text;
  return text[lang] ?? text[DEFAULT_LANG] ?? Object.values(text)[0] ?? "";
};

/** Base path of the developer docs site (same origin as the examples). */
export const DOCS_URL = "/docs";

/**
 * A site-root page that exists per language (the landing page is `""`, the
 * brand assets page `"brand-assets/"`): served at / and /ja/ on navara.world.
 */
export const siteUrl = (lang: Lang, path = ""): string =>
  (lang === "ja" ? "/ja/" : "/") + path;

/**
 * Resolve an example's `docs` value to a full URL. An absolute URL passes
 * through unchanged; otherwise it is treated as a docs-site path and prefixed
 * with {@link DOCS_URL} and the language segment (docs are localized under /ja).
 * e.g. docsUrl("three/tutorial/basic-visualization", "ja")
 *   -> "/docs/ja/three/tutorial/basic-visualization"
 */
export const docsUrl = (docs: string, lang: Lang): string => {
  if (/^https?:\/\//.test(docs)) return docs;
  const langSeg = lang === "ja" ? "/ja" : "";
  return `${DOCS_URL}${langSeg}/${docs.replace(/^\//, "")}`;
};

/** Heading shown for each section in the gallery, per language. */
export const SECTION_LABELS: Record<SectionKey, Record<Lang, string>> = {
  "getting-started": { en: "Getting Started", ja: "Getting Started" },
  "2d": { en: "2D", ja: "2D" },
  "2.5d": { en: "2.5D", ja: "2.5D" },
  "3d": { en: "3D", ja: "3D" },
  basemap: { en: "Basemap", ja: "ベースマップ" },
  terrain: { en: "Terrain", ja: "地形" },
  "tiles-3d": { en: "3D Tiles", ja: "3D Tiles" },
  styling: { en: "Styling", ja: "スタイリング" },
  interaction: { en: "Interaction & UI", ja: "インタラクション・UI" },
  "lighting-effect": {
    en: "Lighting & Effects",
    ja: "ライティング・エフェクト",
  },
};

export type ExampleMeta = {
  /** Display section this example is grouped under (decoupled from directory). */
  section: SectionKey;
  /** Title shown on the card and detail header. */
  title: Localized;
  /** One-line summary of what the example does. */
  description: Localized;
  /** Featured (★). Surfaced in the top "Featured" band. */
  signature?: boolean;
  /** Sort order within its section/group (ascending; unset sorts last). */
  order?: number;
  /**
   * Optional sub-group label within a section, e.g. "Weather" / "Post Effects"
   * under lighting-effect. Entries sharing the same resolved label are grouped.
   */
  group?: Localized;
  /**
   * Optional docs link for the primary API. Either a docs-site path (e.g.
   * "three/tutorial/basic-visualization", localized + prefixed via docsUrl())
   * or an absolute URL.
   */
  docs?: string;
};

/** A gallery entry: the example's meta enriched with its resolved path. */
export type ExampleEntry = ExampleMeta & {
  /**
   * Directory path relative to `examples/`, e.g. "getting-started/hello-world".
   * Doubles as the detail-page URL (`/<path>`), the demo URL (`/demo/<path>`)
   * and the screenshot key (`/screenshots/<path>.avif`).
   */
  path: string;
};
