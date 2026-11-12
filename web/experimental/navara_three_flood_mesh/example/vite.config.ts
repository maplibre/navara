import { cpSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, type Plugin } from "vite";

const PUBLIC_DIR = resolve(import.meta.dirname, "public");

/**
 * The built `datasets.json` lists the datasets not marked `"publish": false`,
 * and the build copies in their data from `public/`. A dataset whose data is
 * not there is left out with a warning, so a checkout without the (untracked)
 * data still builds.
 */
const publishDatasets = (): Plugin => {
  let outDir = "";
  const copied: string[] = [];
  return {
    name: "publish-flood-datasets",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle() {
      const datasets = JSON.parse(
        readFileSync(resolve(import.meta.dirname, "datasets.json"), "utf8"),
      ) as Record<string, { url: string; publish?: boolean }>;
      const published = Object.entries(datasets).filter(
        ([key, { url, publish }]) => {
          if (publish === false) return false;
          // Hosted elsewhere.
          if (URL.canParse(url)) return true;
          if (!existsSync(resolve(PUBLIC_DIR, url))) {
            this.warn(
              `Dataset "${key}" left out: ${url} is not in example/public`,
            );
            return false;
          }
          copied.push(url);
          return true;
        },
      );
      this.emitFile({
        type: "asset",
        fileName: "datasets.json",
        source: JSON.stringify(Object.fromEntries(published)),
      });
    },
    writeBundle() {
      for (const url of copied) {
        cpSync(resolve(PUBLIC_DIR, url), resolve(outDir, url), {
          recursive: true,
        });
      }
    },
  };
};

// A Zarr chunk left out of the store must answer 404, which zarrita reads as
// empty, not the SPA fallback page.
export default defineConfig(({ command }) => ({
  appType: "mpa",
  plugins: [publishDatasets()],
  ...(command === "build" && {
    // Deploys under https://navara.world/navara-three-flood-mesh/ (see
    // scripts/assemble-site.mjs at the repo root).
    base: "/navara-three-flood-mesh/",
    // publishDatasets copies the published data in instead.
    publicDir: false as const,
    build: { outDir: "../dist-example", emptyOutDir: true },
  }),
}));
