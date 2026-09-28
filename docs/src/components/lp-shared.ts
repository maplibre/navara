// Shared between the landing page, the brand assets page and the site chrome
// (LpHeader / LpFooter): locale strings, link helpers and the theme root style.
import lp from "../data/lp.json";

// The root locale is served at "/" without a path prefix (matches Starlight).
export const ROOT_LOCALE = "en";

// Locales the docs site is built in (see astro.config.mjs `locales`). The LP
// can exist in more locales than the docs; LP-only locales link to the
// root-locale docs instead of a /docs/<locale>/ tree that doesn't exist.
export const DOCS_LOCALES = new Set(["en", "ja"]);

// The docs deploy base ("/docs" on navara.world — see astro.config.mjs).
// Docs-internal links carry it; site-root links (the LP, /examples) do not.
export const DOCS_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const localeModules = import.meta.glob<{ default: any }>("../data/lp-locales/*.json", {
  eager: true,
});
export const lpLocales: Record<string, any> = {};
for (const [path, mod] of Object.entries(localeModules)) {
  const code = path.match(/([\w-]+)\.json$/)?.[1];
  if (code) lpLocales[code] = mod.default;
}

export function getLpLocale(locale: string): any {
  const t = lpLocales[locale];
  if (!t) throw new Error(`LP locale strings not found: ${locale}`);
  return t;
}

// Prefix a docs-internal link with the deploy base and the locale path
// segment (root and LP-only locales have none). Absolute URLs pass through.
export function docsHref(locale: string, href: string): string {
  if (!href.startsWith("/")) return href;
  const localeSeg = locale === ROOT_LOCALE || !DOCS_LOCALES.has(locale) ? "" : `/${locale}`;
  return `${DOCS_BASE}${localeSeg}${href}`;
}

// A site-root page that exists per LP locale (the LP itself is `""`, the brand
// assets page `"brand-assets/"`): served at / and /<locale>/ on navara.world
// (scripts/assemble-site.mjs relocates them out of the docs build).
export function siteHref(locale: string, path = ""): string {
  return (locale === ROOT_LOCALE ? "/" : `/${locale}/`) + path;
}

// The theme, as the inline style of <html>. --pri-ink duplicates --pri as the
// always-dark side of the palette (see styles/lp-base.css).
const { colors } = lp;
export const lpRootStyle = `--pri:${colors.primary};--pri-ink:${colors.primary};--acc:${colors.accent};--sub:${colors.sub};--ml:${colors.maplibre};--acc-hero:${colors.heroAccent};--mark-why:${colors.whyUnderline}`;
