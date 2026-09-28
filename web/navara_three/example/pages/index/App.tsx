import { Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import invariant from "tiny-invariant";

import {
  SECTION_KEYS,
  SECTION_LABELS,
  localize,
  type ExampleEntry,
  type ExampleMeta,
} from "../examples/sections";

import { ExampleGrid } from "./ExampleGrid";

import { useLang } from "@/components/hooks/useLang";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Input } from "@/components/ui/input";

import "./main.css";
import "./theme.css";

/** UI chrome strings (the gallery's own labels, not example content). */
const UI = {
  featured: { en: "Featured", ja: "注目の機能" },
  searchPlaceholder: { en: "Search examples…", ja: "Example を検索…" },
  toggleLang: { en: "Switch language", ja: "言語を切り替え" },
  noMatch: {
    en: "No examples match",
    ja: "一致する example がありません",
  },
} as const;

/**
 * Collect every curated example's `meta.ts`. Display section, ordering and the
 * Featured band are all driven by these files (see examples/sections.ts).
 */
const metaModules = import.meta.glob<{ default: ExampleMeta }>(
  "../examples/**/meta.ts",
  { eager: true },
);

const ENTRIES: ExampleEntry[] = Object.entries(metaModules).map(
  ([key, mod]) => {
    // "../examples/getting-started/hello-world/meta.ts" -> "getting-started/hello-world"
    const path = key
      .replace(/^\.\.\/examples\//, "")
      .replace(/\/meta\.ts$/, "");
    return {
      ...mod.default,
      path,
    };
  },
);

export const App = () => {
  const [query, setQuery] = useState("");
  const { lang, setLang } = useLang();

  // Ascending by `order`, then alphabetically by the localized title.
  const byOrder = useMemo(
    () => (a: ExampleEntry, b: ExampleEntry) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER) ||
      localize(a.title, lang).localeCompare(localize(b.title, lang)),
    [lang],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ENTRIES;
    return ENTRIES.filter(
      (e) =>
        localize(e.title, lang).toLowerCase().includes(q) ||
        localize(e.description, lang).toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q),
    );
  }, [query, lang]);

  const featured = useMemo(
    () => filtered.filter((e) => e.signature).sort(byOrder),
    [filtered, byOrder],
  );

  // Group by display section (in SECTION_KEYS order), then by sub-group.
  const sections = useMemo(() => {
    return SECTION_KEYS.map((key) => {
      const inSection = filtered.filter((e) => e.section === key).sort(byOrder);
      // Group by the localized sub-group label, preserving first-seen order.
      const groups: {
        label: string;
        entries: ExampleEntry[];
      }[] = [];
      for (const entry of inSection) {
        const label = localize(entry.group, lang);
        const existing = groups.find((g) => g.label === label);
        if (existing) existing.entries.push(entry);
        else groups.push({ label, entries: [entry] });
      }
      return { key, groups, count: inSection.length };
    }).filter((s) => s.count > 0);
  }, [filtered, byOrder, lang]);

  return (
    <div className="h-screen w-screen overflow-auto bg-background text-foreground">
      <SiteHeader
        lang={lang}
        setLang={setLang}
        langLabel={localize(UI.toggleLang, lang)}
      />
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-12">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={localize(UI.searchPlaceholder, lang)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </header>

        {featured.length > 0 && (
          <section className="mb-12">
            <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Star className="h-4 w-4 fill-current text-primary" />
              {localize(UI.featured, lang)}
            </h2>
            <ExampleGrid entries={featured} lang={lang} />
          </section>
        )}

        {sections.map((section) => (
          <section key={section.key} className="mb-12">
            <h2 className="mb-5 text-lg font-semibold tracking-tight">
              {SECTION_LABELS[section.key][lang]}
            </h2>
            {section.groups.map((group, i) => (
              <div key={group.label || i} className="mb-6">
                {group.label && (
                  <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                    {group.label}
                  </h3>
                )}
                <ExampleGrid entries={group.entries} lang={lang} />
              </div>
            ))}
          </section>
        ))}

        {sections.length === 0 && featured.length === 0 && (
          <p className="text-muted-foreground">
            {localize(UI.noMatch, lang)} “{query}”.
          </p>
        )}
      </div>
      <SiteFooter lang={lang} />
    </div>
  );
};

const root = document.getElementById("main");
invariant(root);
createRoot(root).render(<App />);
