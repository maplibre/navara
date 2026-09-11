/// <reference types="vitest/config" />
import fs from "fs";
import path from "path";
import { ConfigEnv, normalizePath } from "vite";
import { PluginOption, type UserConfig } from "vite";

import tsconfig from "vite-tsconfig-paths";
import wasm from "vite-plugin-wasm";
import dts from "unplugin-dts/vite";
import topLevelAwait from "vite-plugin-top-level-await";
// This is necessary to watch shared packages.
// Ref: https://github.com/vitejs/vite/issues/8619#issuecomment-2019967424
function watchPackages(packageNames: string[]): PluginOption {
  return {
    name: "vite-plugin-watch-packages",
    buildStart() {
      packageNames.forEach((packageName) => {
        const absPackagePath = normalizePath(path.resolve(
          __dirname,
          "../node_modules",
          packageName
        ));
        const realPackagePath = fs.realpathSync(absPackagePath);

        this.addWatchFile(realPackagePath);
      });
    },
  };
}

// Vite force-inlines every referenced asset as a base64 data URL in lib mode,
// including the wasm-bindgen `new URL('*.wasm', import.meta.url)` references
// bundled into worker chunks. That grows the .wasm by ~33% and prevents
// streaming compilation. Appending Vite's `?no-inline` query opts the .wasm
// out of inlining so it is emitted as a fetchable asset instead.
function noInlineWasm(): PluginOption {
  return {
    name: "vite-plugin-no-inline-wasm",
    apply: "build",
    transform(code) {
      if (!code.includes(".wasm")) return;
      const replaced = code.replace(
        /new URL\(\s*(['"])([^'"]+\.wasm)\1\s*,\s*import\.meta\.url\s*\)/g,
        "new URL('$2?no-inline', import.meta.url)",
      );
      return replaced === code ? undefined : { code: replaced, map: null };
    },
    // Modules that reference a .wasm can be loaded during the build but
    // tree-shaken from the output (e.g. type-only usage of an external
    // package); their emitted .wasm would remain as an orphan file. Drop any
    // .wasm asset no chunk or textual asset actually refers to.
    generateBundle(_options, bundle) {
      const texts: string[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type === "chunk") texts.push(item.code);
        else if (typeof item.source === "string") texts.push(item.source);
      }
      for (const fileName of Object.keys(bundle)) {
        if (!fileName.endsWith(".wasm")) continue;
        const base = fileName.split("/").pop() ?? fileName;
        if (!texts.some((text) => text.includes(base))) {
          delete bundle[fileName];
        }
      }
    },
  };
}

// Runtime assets under a package's `assets/` directory are referenced with
// static `new URL(..., import.meta.url)` calls so downstream bundlers can
// detect and emit them. Emit them at their original `assets/...` paths
// (unhashed) so they coincide with the viteStaticCopy'd directory instead of
// being duplicated under hashed names, keeping a single stable on-disk
// layout for the package's assets.
export function assetFileNamesPreservingAssetsDir(assetInfo: {
  originalFileNames?: string[];
}): string {
  const original = (assetInfo.originalFileNames?.[0] ?? "").replace(
    /\?.*$/,
    "",
  );
  return /^assets\//.test(original)
    ? original
    : "assets/[name]-[hash][extname]";
}

function getPluginName(plugin: PluginOption): string | undefined {
  if (plugin && typeof plugin === "object" && "name" in plugin) {
    return plugin.name;
  }
  return undefined;
}

export function composePlugins(
  env: ConfigEnv,
  additionalPlugins: PluginOption[] = [],
): PluginOption[] {
  const basePlugins: PluginOption[] = [
    watchPackages(["@navaramap/engine", "@navaramap/engine-worker", "@navaramap/engine-font-worker", "@navaramap/engine-api"]),
    noInlineWasm(),
    tsconfig(),
    dts({ bundleTypes: true, tsconfigPath: "./tsconfig.build.json" }),
    ...(env.mode !== "production" ? [wasm(), topLevelAwait()] : []),
  ];

  const overrideNames = new Set(
    additionalPlugins.map(getPluginName).filter((n): n is string => n != null),
  );

  const filtered = basePlugins.filter((p) => {
    const name = getPluginName(p);
    return name == null || !overrideNames.has(name);
  });

  return [...filtered, ...additionalPlugins];
}

export const commonConfig = (name: string, env: ConfigEnv) => ({
  plugins: composePlugins(env),
  resolve: {
    mainFields: ["module"],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(env.mode),
  },
  build: {
    lib: {
      entry: "./src/index.ts",
      name,
      fileName: "index",
    },
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      external: ["@navaramap/engine", "@navaramap/engine-worker", "@navaramap/engine-font-worker", "@navaramap/engine-api"],
    },
    watch:
      env.mode === "watch"
        ? {
            buildDelay: 100,
          }
        : undefined,
  },
  test: {
    environment: "jsdom",
  }
}) satisfies UserConfig;
