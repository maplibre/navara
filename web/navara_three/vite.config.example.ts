import { existsSync, readdirSync, readFileSync } from "fs";
import path, { resolve } from "path";

import react from "@vitejs/plugin-react";
import { defineConfig, normalizePath, transformWithEsbuild } from "vite";
import glsl from "vite-plugin-glsl";
import { viteStaticCopy } from "vite-plugin-static-copy";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import tsconfig from "vite-tsconfig-paths";

import { commonConfig } from "../vite.config.common";

import { createMpaPlugin } from "./vite-plugin-mpa";

type PageInfo = {
  name: string;
  category: string;
  displayName: string;
};

/**
 * Directories under `example/pages` that hold a shared entrypoint (a `main.tsx`
 * reused by other pages) rather than a standalone page. They must not be
 * registered as their own MPA page or listed in the launchers. `detail` is the
 * shared React presentation template rendered at `/<section>/<slug>` for each
 * curated example.
 */
const SHARED_ENTRY_DIRS = new Set(["detail"]);

/**
 * Recursively discover example pages in nested directories.
 * A directory is considered a page if it contains a main.ts file.
 * Otherwise, it's treated as a category directory.
 */
function getExamplePages(
  baseDir: string,
  prefix = "",
): { name: string; path: string }[] {
  const entries = readdirSync(baseDir, { withFileTypes: true });
  const pages: { name: string; path: string }[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!prefix && SHARED_ENTRY_DIRS.has(entry.name)) {
        // Shared entrypoint, not a page of its own.
        continue;
      }
      const fullPath = resolve(baseDir, entry.name);
      const mainFile = resolve(fullPath, "main.ts");
      const mainTsxFile = resolve(fullPath, "main.tsx");

      if (existsSync(mainFile) || existsSync(mainTsxFile)) {
        // This is a page directory
        const pageName = prefix ? `${prefix}/${entry.name}` : entry.name;
        pages.push({ name: pageName, path: fullPath });
      } else {
        // This is a category directory, recurse
        const nestedPages = getExamplePages(
          fullPath,
          prefix ? `${prefix}/${entry.name}` : entry.name,
        );
        pages.push(...nestedPages);
      }
    }
  }

  return pages;
}

const examplePages = getExamplePages(resolve(__dirname, "example/pages"));

// Social/meta defaults for the generated pages. Curated example pages get
// their own title/description from their meta.ts; the thumbnail is the shared
// site OG image for every page — the gallery screenshots carry no baked data
// credits, so they can't be used as social thumbnails (public/og.jpg is the
// credited docs/public/og.jpg, copied verbatim).
const SITE_ORIGIN = "https://navara.world/examples";
const SITE_TITLE = "Navara Examples";
const SITE_DESCRIPTION =
  "Interactive examples for Navara, a highly extensible 3D map engine. See what it can do live in your browser, from declarative layers to plugins and custom shaders.";
const OG_IMAGE = `${SITE_ORIGIN}/og.jpg`;

type LocalizedText = Record<string, string>;
type LoadedExampleMeta = {
  title?: LocalizedText;
  description?: LocalizedText;
};

/**
 * Load a curated example's meta.ts at config time (for the static meta tags).
 * The files are TypeScript with type-only imports, so stripping types (via
 * vite's esbuild wrapper) and evaluating the CommonJS output is enough — no
 * bundling needed.
 */
async function loadExampleMeta(dir: string): Promise<LoadedExampleMeta | null> {
  const file = resolve(dir, "meta.ts");
  if (!existsSync(file)) return null;
  const { code } = await transformWithEsbuild(
    readFileSync(file, "utf8"),
    file,
    {
      format: "cjs",
    },
  );
  const mod = { exports: {} as { default?: LoadedExampleMeta } };
  new Function("module", "exports", "require", code)(
    mod,
    mod.exports,
    () => ({}),
  );
  return mod.exports.default ?? null;
}

// Convert to PageInfo for the PAGES global
const pageInfos: PageInfo[] = examplePages.map(({ name }) => ({
  name,
  category: name.includes("/") ? name.split("/")[0] : "uncategorized",
  displayName: name.includes("/") ? (name.split("/").pop() ?? name) : name,
}));

export default defineConfig(async (env) => {
  const common = commonConfig("NavaraExample", env);

  const mpaPages = (
    await Promise.all(
      examplePages.map(async ({ name, path: dir }) => {
        const mainFile = existsSync(resolve(dir, "main.tsx"))
          ? "main.tsx"
          : "main.ts";

        // Curated examples get two entries with clean, slash-separated URLs:
        //   detail (presentation)  -> /<section>/<slug>       (shared React template)
        //   demo   (iframe target) -> /demo/<section>/<slug>  (the raw full-screen demo)
        if (name.startsWith("examples/")) {
          const rel = name.replace(/^examples\//, "");
          // Static meta tags carry the root-locale (en) strings; the page
          // itself localizes at runtime.
          const meta = await loadExampleMeta(dir);
          const title = meta?.title?.en
            ? `${meta.title.en} | ${SITE_TITLE}`
            : SITE_TITLE;
          const description = meta?.description?.en ?? SITE_DESCRIPTION;
          return [
            {
              name: rel,
              filename: `${rel}.html`,
              entry: normalizePath(`/example/pages/detail/main.tsx`),
              data: {
                title,
                description,
                image: OG_IMAGE,
                url: `${SITE_ORIGIN}/${rel}`,
              },
            },
            {
              name: `demo/${rel}`,
              filename: `demo/${rel}.html`,
              entry: normalizePath(`/example/pages/${name}/${mainFile}`),
              data: {
                title,
                description,
                image: OG_IMAGE,
                url: `${SITE_ORIGIN}/demo/${rel}`,
              },
            },
          ];
        }

        // Everything else (gallery index, dev launcher, debug/*, legacy demos):
        // dash URLs, with a trailing "/index" collapsed to its parent ("dev/index" -> /dev).
        const urlName = name.replace(/\/index$/, "").replace(/\//g, "-");
        return [
          {
            name: urlName,
            filename: `${urlName}.html`,
            entry: normalizePath(`/example/pages/${name}/${mainFile}`),
            data: {
              title: SITE_TITLE,
              description: SITE_DESCRIPTION,
              image: OG_IMAGE,
              url:
                urlName === "index"
                  ? `${SITE_ORIGIN}/`
                  : `${SITE_ORIGIN}/${urlName}`,
            },
          },
        ];
      }),
    )
  ).flat();
  return {
    ...common,
    // The examples deploy under https://navara.world/examples/ (see
    // scripts/assemble-site.mjs at the repo root); the dev server mirrors the
    // prefix so root-absolute path regressions surface locally.
    base: "/examples/",
    envPrefix: "NAVARA",
    plugins: [
      glsl(),
      tsconfig(),
      react(),
      viteStaticCopy({
        targets: [
          {
            src: normalizePath(resolve(__dirname, "./assets")),
            dest: "./",
          },
          {
            // The prebuilt @navaramap/three worker chunks are re-emitted here as
            // opaque assets, so Vite never sees the .wasm they fetch relative
            // to their own URL at runtime; copy those files through verbatim.
            src: normalizePath(resolve(__dirname, "./dist/assets/*.wasm")),
            dest: "./",
            rename: { stripBase: true },
          },
        ],
      }),
      createMpaPlugin({
        templatePath: resolve(__dirname, "example/template.html"),
        pages: mpaPages,
      }),
      ...(env.mode !== "production" ? [wasm(), topLevelAwait()] : []),
    ],
    define: {
      PAGES: JSON.stringify(pageInfos),
    },
    build: {
      outDir: "dist-example",
      assetsDir: "./",
    },
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@shaders": normalizePath(path.resolve(__dirname, "../../shaders")),
        // For dev server, import packages directly from source to avoid bundling.
        ...(env.command === "serve"
          ? {
              "@navaramap/three": normalizePath(
                path.resolve(__dirname, "./src"),
              ),
              "@navaramap/core": normalizePath(
                path.resolve(__dirname, "../navara_core/src"),
              ),
              "@navaramap/three-api": normalizePath(
                path.resolve(__dirname, "../navara_three_api/src"),
              ),
              "@navaramap/three-csm": normalizePath(
                path.resolve(__dirname, "../navara_three_csm/src"),
              ),
              "@navaramap/three-default-plugin": normalizePath(
                path.resolve(__dirname, "../navara_three_default_plugin/src"),
              ),
              "@navaramap/three-react": normalizePath(
                path.resolve(__dirname, "../navara_three_react/src"),
              ),
              "@navaramap/maplibre-style": normalizePath(
                path.resolve(__dirname, "../navara_maplibre_style/src"),
              ),
              "@navaramap/worker": normalizePath(
                path.resolve(__dirname, "../navara_worker/src"),
              ),
            }
          : {
              // For production example builds, consume the built library output.
              "@navaramap/three": normalizePath(
                path.resolve(__dirname, "./dist"),
              ),
            }),
      },
    },
    publicDir: normalizePath(path.resolve(__dirname, "./example/public")),
    envDir: normalizePath(path.resolve(__dirname, "./example")),
    worker: {
      plugins: () => [tsconfig()],
    },
    server: {
      open: true,
      fs: {
        // The dev server listens on the LAN (`--host`): serve the repo only.
        allow: [normalizePath(path.resolve(__dirname, "../.."))],
      },
    },
  };
});
