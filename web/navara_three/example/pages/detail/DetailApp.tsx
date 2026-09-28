import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HighlighterCore } from "shiki/core";

import { withBase } from "../../helpers/base";
import { SCENE_LOADED_MESSAGE } from "../../helpers/initialize";
import { docsUrl, localize, SECTION_LABELS } from "../examples/sections";
import type { ExampleMeta, Lang, Localized } from "../examples/sections";

import { useLang } from "@/components/hooks/useLang";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import "../index/main.css";
import "../index/theme.css";

/** UI chrome strings for the detail page. */
const UI = {
  source: { en: "Source", ja: "ソースコード" },
  copy: { en: "Copy", ja: "コピー" },
  copied: { en: "Copied", ja: "コピーしました" },
  openDemo: { en: "Open demo", ja: "デモを開く" },
  docs: { en: "Docs", ja: "ドキュメント" },
  notFound: { en: "Example not found", ja: "example が見つかりません" },
  toggleLang: { en: "Switch language", ja: "言語を切り替え" },
} satisfies Record<string, Record<Lang, string>>;

/**
 * Every curated example's meta and its raw source, collected once. Keyed by the
 * example path relative to `examples/`, e.g. "getting-started/hello-world".
 * The raw source is provided to the page as data via vite's `?raw` import.
 */
const META = keyBy(
  import.meta.glob<{ default: ExampleMeta }>("../examples/**/meta.ts", {
    eager: true,
  }),
  /\/meta\.ts$/,
  (m) => m.default,
);

type SourceLang = "ts" | "tsx";
type CodeEntry = { source: string; lang: SourceLang };
type CodeLoader = { load: () => Promise<string>; lang: SourceLang };

/**
 * Raw example sources, as lazy per-example loaders (non-eager glob): bundling
 * every example's source into the page chunk would make the embedded demo
 * wait on parsing all of them; only the displayed example's source is fetched.
 */
const CODE_LOADERS: Record<string, CodeLoader> = {};
for (const [key, load] of Object.entries(
  import.meta.glob<string>("../examples/**/main.{ts,tsx}", {
    query: "?raw",
    import: "default",
  }),
)) {
  const lang: SourceLang = key.endsWith(".tsx") ? "tsx" : "ts";
  const path = key
    .replace(/^\.\.\/examples\//, "")
    .replace(/\/main\.(ts|tsx)$/, "");
  CODE_LOADERS[path] = { load, lang };
}

/**
 * Lazily created, shared Shiki highlighter for the example sources.
 *
 * Fine-grained core, dynamically imported: keeps Shiki (and its grammar/theme
 * data) out of the page's initial bundle so parsing it cannot delay the demo
 * iframe's startup, and uses the JavaScript regex engine instead of the
 * oniguruma WASM one — compiling a second WASM module while the embedded demo
 * compiles the engine's WASM is exactly the main-thread contention the
 * deferred highlighting is meant to avoid.
 */
let highlighterPromise: Promise<HighlighterCore> | null = null;
function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [core, engine, ts, tsx, light, dark] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
        import("shiki/dist/langs/typescript.mjs"),
        import("shiki/dist/langs/tsx.mjs"),
        import("shiki/dist/themes/github-light.mjs"),
        import("shiki/dist/themes/github-dark.mjs"),
      ]);
      return core.createHighlighterCore({
        themes: [light.default, dark.default],
        langs: [ts.default, tsx.default],
        engine: engine.createJavaScriptRegexEngine(),
      });
    })();
  }
  return highlighterPromise;
}

function keyBy<M, T>(
  modules: Record<string, M>,
  fileSuffix: RegExp,
  pick: (mod: M) => T,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, mod] of Object.entries(modules)) {
    const path = key.replace(/^\.\.\/examples\//, "").replace(fileSuffix, "");
    out[path] = pick(mod);
  }
  return out;
}

/**
 * Loading screen over the demo iframe. Scene loading has no measurable
 * progress (tiles stream until the engine settles), so a pseudo-progress
 * eases toward 90% over time, snaps to 100% on `done`, and the overlay fades
 * once 100% has been visible.
 *
 * Isolated in its own component so its periodic progress updates re-render
 * only this small subtree. Re-rendering the whole page during load is
 * main-thread work that, on iOS, the embedded demo's process has to share.
 * The interval is deliberately coarse (not requestAnimationFrame). The bar's
 * CSS width transition keeps it smooth between ticks.
 */
const DemoLoadingOverlay = ({ done }: { done: boolean }) => {
  const [gone, setGone] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (done) {
      const timer = window.setTimeout(() => setGone(true), 450);
      return () => window.clearTimeout(timer);
    }
    const start = performance.now();
    const interval = window.setInterval(() => {
      const elapsed = (performance.now() - start) / 1000;
      setProgress(0.9 * (1 - Math.exp(-elapsed / 3)));
    }, 200);
    return () => window.clearInterval(interval);
  }, [done]);
  const shown = done ? 1 : progress;

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded-lg border bg-background transition-opacity duration-500 ${
        gone ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="h-1 w-[220px] overflow-hidden rounded-full bg-foreground/15">
        <div
          className="h-full rounded-full bg-foreground/85 transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.round(shown * 100)}%` }}
        />
      </div>
      <span className="mt-3 text-xs tabular-nums text-foreground/70">
        {Math.round(shown * 100)}%
      </span>
    </div>
  );
};

/** Current example path from the URL, e.g. "/examples/getting-started/hello-world" -> "getting-started/hello-world". */
function currentPath(): string {
  return window.location.pathname
    .replace(withBase("/"), "")
    .replace(/^\//, "")
    .replace(/\.html$/, "")
    .replace(/\/$/, "");
}

export const DetailApp = () => {
  const { lang, setLang } = useLang();
  const [copied, setCopied] = useState(false);

  const path = useMemo(() => currentPath(), []);
  const meta = META[path];
  const codeLoader = CODE_LOADERS[path];
  const demoSrc = withBase(`demo/${path}`);

  // Whether the embedded demo has finished loading (scene-loaded message or
  // failsafe). Drives the loading overlay.
  const [demoLoaded, setDemoLoaded] = useState(false);

  // The displayed example's raw source. Loaded as its own chunk (see
  // CODE_LOADERS) so the page bundle stays free of every other example's
  // source; the card appears once it arrives.
  const [code, setCode] = useState<CodeEntry | null>(null);
  useEffect(() => {
    if (!codeLoader) {
      return;
    }
    let cancelled = false;
    codeLoader
      .load()
      .then((source) => {
        if (!cancelled) setCode({ source, lang: codeLoader.lang });
      })
      .catch(() => {
        // Leave the card hidden if the source chunk fails to load.
      });
    return () => {
      cancelled = true;
    };
  }, [codeLoader]);

  // Shiki-highlighted markup for the source. Falls back to plain text while
  // the highlighter (dynamically imported, see getHighlighter) loads or if
  // highlighting fails.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  useEffect(() => {
    if (!code) {
      return;
    }
    let cancelled = false;
    getHighlighter()
      .then((hl) =>
        hl.codeToHtml(code.source, {
          lang: code.lang,
          themes: { light: "github-light", dark: "github-dark" },
          // Emit CSS variables so the `.dark` class drives the theme without
          // re-highlighting on toggle.
          defaultColor: false,
        }),
      )
      .then((html) => {
        if (!cancelled) setHighlighted(html);
      })
      .catch(() => {
        if (!cancelled) setHighlighted(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Demo/page scroll arbitration. The embedded map reacts to wheel events but
  // does not preventDefault, so a wheel over the iframe both zooms the map and
  // chains out to scroll this page. We resolve the conflict by intent:
  //   - Pointer resting over the demo (not mid-scroll) => "engaged": lock the
  //     page scroll so the wheel only drives the map.
  //   - The page is being scrolled => page wins: a transparent shield covers the
  //     iframe so the gesture keeps scrolling the document and never reaches the
  //     map, even while the cursor passes over it. When scrolling settles, the
  //     shield lifts and, if the pointer is still over the demo, we engage.
  const demoRef = useRef<HTMLIFrameElement>(null);

  // Loading screen over the demo (see DemoLoadingOverlay). This page owns the
  // overlay so it also covers the time before the iframe document loads; the
  // demo posts SCENE_LOADED_MESSAGE from its view's first `idle` event to
  // dismiss it (`demoLoaded`, declared above the source-loading effect).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        (event.data as { type?: string } | null)?.type ===
          SCENE_LOADED_MESSAGE &&
        event.source === demoRef.current?.contentWindow
      ) {
        setDemoLoaded(true);
      }
    };
    window.addEventListener("message", onMessage);
    // Failsafe: if the scene-loaded message never arrives (lost postMessage,
    // demo init failure, iOS quirks), lift the opaque overlay anyway instead
    // of hiding the demo forever.
    const failsafe = window.setTimeout(() => setDemoLoaded(true), 15000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(failsafe);
    };
  }, []);

  const pointerInsideRef = useRef(false);
  const scrollIdleTimer = useRef<number | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [scrolling, setScrolling] = useState(false);

  const engageDemo = () => {
    setEngaged(true);
    demoRef.current?.contentWindow?.focus();
  };

  // Any wheel/scroll on the page gives the document priority and defers demo
  // engagement until the gesture has settled.
  const noteScroll = () => {
    setScrolling(true);
    setEngaged(false);
    if (scrollIdleTimer.current !== null) {
      window.clearTimeout(scrollIdleTimer.current);
    }
    scrollIdleTimer.current = window.setTimeout(() => {
      setScrolling(false);
      if (pointerInsideRef.current) engageDemo();
    }, 200);
  };

  const onDemoPointerEnter = () => {
    pointerInsideRef.current = true;
    if (!scrolling) engageDemo();
  };
  const onDemoPointerLeave = () => {
    pointerInsideRef.current = false;
    setEngaged(false);
  };

  useEffect(() => {
    return () => {
      if (scrollIdleTimer.current !== null) {
        window.clearTimeout(scrollIdleTimer.current);
      }
    };
  }, []);

  const copy = () => {
    if (!code) return;
    navigator.clipboard
      .writeText(code.source)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Ignore clipboard errors (e.g., permissions / insecure context).
      });
  };

  const t = (text: Localized) => localize(text, lang);

  return (
    <div
      onWheel={noteScroll}
      onScroll={noteScroll}
      className={`h-screen w-screen bg-background text-foreground [scrollbar-gutter:stable] ${
        engaged ? "overflow-hidden" : "overflow-auto"
      }`}
    >
      <SiteHeader lang={lang} setLang={setLang} langLabel={t(UI.toggleLang)} />
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-8 flex min-w-0 flex-col gap-2">
          {meta && (
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
                {t(meta.title)}
              </h1>
              <p className="text-xs text-muted-foreground">
                {SECTION_LABELS[meta.section][lang]}
              </p>
            </div>
          )}
        </header>

        {!meta ? (
          <p className="text-muted-foreground">
            {t(UI.notFound)} “{path}”.
          </p>
        ) : (
          <>
            <p className="mb-5 text-sm text-muted-foreground">
              {t(meta.description)}
            </p>

            <div className="mb-6 flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="-ml-2 px-2 text-muted-foreground hover:text-foreground"
              >
                <a
                  href={demoSrc}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t(UI.openDemo)}
                </a>
              </Button>
              {meta.docs && (
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="px-2 text-muted-foreground hover:text-foreground"
                >
                  <a
                    href={docsUrl(meta.docs, lang)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t(UI.docs)}
                  </a>
                </Button>
              )}
            </div>

            <div className="relative mb-8 h-[520px]">
              <iframe
                ref={demoRef}
                src={demoSrc}
                title={t(meta.title)}
                onPointerEnter={onDemoPointerEnter}
                onPointerLeave={onDemoPointerLeave}
                onTouchStart={onDemoPointerEnter}
                onTouchEnd={onDemoPointerLeave}
                onTouchCancel={onDemoPointerLeave}
                // Absolutely positioned (not in-flow h-full) so iOS Safari's
                // iframe-expands-to-content sizing cannot grow the frame and
                // feed a canvas resize loop in the embedded demo.
                className="absolute inset-0 block h-full w-full rounded-lg border bg-muted"
              />
              <DemoLoadingOverlay done={demoLoaded} />
              {scrolling && (
                // Transparent shield: while the page is scrolling, it catches the
                // wheel so the gesture keeps scrolling the document instead of
                // reaching (and zooming) the map. It tracks the pointer so the
                // demo can engage once scrolling settles.
                <div
                  onPointerEnter={() => {
                    pointerInsideRef.current = true;
                  }}
                  onPointerLeave={() => {
                    pointerInsideRef.current = false;
                  }}
                  className="absolute inset-0 rounded-lg"
                />
              )}
            </div>

            {code && (
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b py-3">
                  <CardTitle className="text-sm font-medium">
                    {t(UI.source)}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copy}
                    className="flex items-center gap-1.5"
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied ? t(UI.copied) : t(UI.copy)}
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {highlighted ? (
                    <div
                      className="shiki-source"
                      // Shiki output is generated from the trusted local example
                      // source, so rendering it as HTML is safe here.
                      dangerouslySetInnerHTML={{ __html: highlighted }}
                    />
                  ) : (
                    <pre className="overflow-x-auto p-4 text-xs leading-relaxed">
                      <code>{code.source}</code>
                    </pre>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
      <SiteFooter lang={lang} />
    </div>
  );
};
