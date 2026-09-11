// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import rehypeMermaid from "rehype-mermaid";
import { readdir } from "fs/promises";

// Locale directory names to exclude from sidebar generation.
// These are handled by Starlight's built-in locale routing.
const localeDirectories = new Set(["ja"]);

/**
 * Automatically generate sidebar sections based on directory structure
 */
async function autogenSections() {
  const sections = (
    await readdir("./src/content/docs/", {
      withFileTypes: true,
    })
  )
    .filter((x) => x.isDirectory() && !localeDirectories.has(x.name))
    .map((x) => x.name);
  return sections.map((x) => {
    // Starlight v0.39 removed `label` + `autogenerate` shorthand; autogenerate
    // config now goes inside an `items` array.
    return {
      label: x,
      items: [
        {
          autogenerate: {
            directory: x,
            collapsed: false,
          },
        },
      ],
    };
  });
}

const sidebar = await autogenSections();

// https://astro.build/config
export default defineConfig({
  // The whole Astro build ships under https://navara.world/docs. The landing
  // page builds at /docs/lp/ and /docs/<locale>/lp/, then the repo-root
  // scripts/assemble-site.mjs relocates it to the site root (/ and
  // /<locale>/), where its /docs/_astro/... asset URLs still resolve.
  site: "https://navara.world",
  base: "/docs",
  markdown: {
    rehypePlugins: [[rehypeMermaid, { strategy: "inline-svg" }]],
  },
  integrations: [
    starlight({
      title: "Navara Developer Document",
      favicon: "/favicon.png",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/maplibre/navara" }],
      defaultLocale: "root",
      locales: {
        root: {
          lang: "en",
          label: "English",
        },
        ja: {
          label: "日本語",
        },
      },
      customCss: ["./src/styles/theme.css", "./src/styles/mermaid.css"],
      components: {
        Sidebar: "./src/components/Sidebar.astro",
        Pagination: "./src/components/Pagination.astro",
        // The docs share the LP's header (LpHeader.astro via Header.astro);
        // light mode is disabled for now, so the theme provider pins dark and
        // the theme picker renders nothing (see each override).
        Header: "./src/components/Header.astro",
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
      },
      head: [
        // Fonts for the shared LP header (matches LandingPage.astro's set).
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" },
        },
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" },
        },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Arsenal:wght@400;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap",
          },
        },
        // Social thumbnail. Starlight already emits per-page title/description
        // (meta + og:*); og:image is site-wide — the promo poster crop
        // (public/og.jpg, regenerate from public/promo/promo-poster.avif).
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "https://navara.world/og.jpg",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image",
            content: "https://navara.world/og.jpg",
          },
        },
        // TODO: Remove when Navara is released.
        {
          tag: "meta",
          attrs: {
            name: "robots",
            content: "noindex,nofollow",
          },
        },
      ],
      sidebar: sidebar,
    }),
  ],
});
