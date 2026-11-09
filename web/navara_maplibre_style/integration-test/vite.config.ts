import fs from "node:fs";
import path from "node:path";

import { defineConfig, type Plugin } from "vite";

import { ASSETS_DIR } from "./lib/config";
import { buildDemTileFromChildren, isDemTilePath } from "./lib/demFallback";

const ASSETS_PATH_PREFIX = "/maplibre-gl-js/test/integration/assets/";

/**
 * Serves DEM tiles the fixtures lack in the dev server too, as the Playwright
 * spec does (see lib/demFallback.ts), so manual runs see the same data.
 */
function demFallback(): Plugin {
  return {
    name: "dem-fallback",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (!pathname.startsWith(ASSETS_PATH_PREFIX)) return next();
        let relative: string;
        try {
          relative = decodeURIComponent(
            pathname.slice(ASSETS_PATH_PREFIX.length),
          );
        } catch {
          return next();
        }
        const file = path.resolve(ASSETS_DIR, relative);
        if (
          !file.startsWith(ASSETS_DIR + path.sep) ||
          !isDemTilePath(file) ||
          fs.existsSync(file)
        ) {
          return next();
        }
        buildDemTileFromChildren(file).then(
          (body) => {
            if (!body) return next();
            res.setHeader(
              "Content-Type",
              file.endsWith(".webp") ? "image/webp" : "image/png",
            );
            res.end(body);
          },
          (err: unknown) => next(err),
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [demFallback()],
  resolve: {
    alias: {
      // The plugin under test is served from source, so plugin edits need no
      // rebuild. Other @navaramap packages (and WASM) still use their dist.
      "@navaramap/maplibre-style": path.join(
        import.meta.dirname,
        "../src/index.ts",
      ),
    },
    // Linked dist builds would otherwise each pull their own copy of three.
    dedupe: ["three"],
  },
  // The fixture checkout is served but never edited by hand, and the tests
  // write their outputs into it.
  server: {
    watch: {
      ignored: [
        "**/maplibre-gl-js/**",
        "**/render/results.*",
        "**/test-results/**",
      ],
    },
  },
  optimizeDeps: { entries: ["lib/test-page.html"] },
});
