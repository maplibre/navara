import { Moon, Sun, Search, ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import invariant from "tiny-invariant";

import { isGalleryPage } from "../../../pageNames";
import { PageList } from "../../index/PageList";

import { useDarkMode } from "@/components/hooks/useDarkMode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import "../../index/main.css";

/**
 * Dev launcher (served at /dev) — the raw, uncurated list of every page under
 * example/pages. The curated public gallery lives at "/" (index); this page
 * keeps the old flat, grouped-by-directory view for development. Curated
 * `examples/*` pages are excluded here since they are presented in the main
 * gallery.
 */
export const App = () => {
  const [query, setQuery] = useState("");
  const { isDark: dark, toggle } = useDarkMode();

  const pages = useMemo(
    () =>
      (PAGES || [])
        .filter((p) => !isGalleryPage(p.name) && p.name !== "dev/index")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.displayName.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    );
  }, [pages, query]);

  const groupedPages = useMemo(() => {
    const groups: Record<string, PageInfo[]> = {};
    for (const page of filtered) {
      if (!groups[page.category]) {
        groups[page.category] = [];
      }
      groups[page.category].push(page);
    }
    return groups;
  }, [filtered]);

  return (
    <div className="h-screen w-screen overflow-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-12 flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
              Navara Three — Dev Pages
            </h1>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" asChild>
                <a href="/" className="flex items-center gap-1.5">
                  <ArrowLeft className="h-4 w-4" />
                  Gallery
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Toggle theme"
                onClick={toggle}
              >
                {dark ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search pages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </header>

        {Object.entries(groupedPages)
          .sort(([a], [b]) => {
            if (a === "uncategorized") return 1;
            if (b === "uncategorized") return -1;
            if (a === "showcases") return -1;
            if (b === "showcases") return 1;
            return a.localeCompare(b);
          })
          .map(([category, categoryPages]) => (
            <section key={category} className="mb-12">
              <h2 className="mb-5 text-lg font-semibold capitalize tracking-tight">
                {category.replace(/-/g, " ")}
              </h2>
              <PageList pages={categoryPages} />
            </section>
          ))}
      </div>
    </div>
  );
};

const root = document.getElementById("main");
invariant(root);
createRoot(root).render(<App />);
