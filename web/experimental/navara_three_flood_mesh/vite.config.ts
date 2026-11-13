import { defineConfig } from "vite";

import { commonConfig, composePlugins } from "../../vite.config.common";

export default defineConfig((env) => {
  const common = commonConfig("NavaraThreeFloodMesh", env);
  return {
    ...common,
    // The worker is referenced relative to the module, wherever it is served.
    base: "./",
    plugins: composePlugins(env),
    // One file with the Zarr reader and its compressors inlined: an app's
    // bundler copies the worker as an opaque asset under a new name, so
    // chunks it imported relative to itself would be left behind.
    worker: {
      format: "es" as const,
      rolldownOptions: { output: { codeSplitting: false } },
    },
    build: {
      ...common.build,
      lib: {
        ...common.build.lib,
        entry: { index: "./src/index.ts", convert: "./src/convert/index.ts" },
        fileName: (_format, name) => `${name}.js`,
        formats: ["es"],
      },
      rollupOptions: {
        ...common.build.rollupOptions,
        external: [
          "three",
          "@navaramap/three",
          "zarrita",
          "@zarrita/storage",
          "delaunator",
          "earcut",
          // A dependency; a browser shares the instance `ThreeView` inits.
          "@navaramap/engine-api",
        ],
        output: { chunkFileNames: "[name]-[hash].js" },
      },
    },
  };
});
