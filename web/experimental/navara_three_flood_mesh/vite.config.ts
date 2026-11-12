import { defineConfig } from "vite";

import { commonConfig, composePlugins } from "../../vite.config.common";

export default defineConfig((env) => {
  const common = commonConfig("NavaraThreeFloodMesh", env);
  return {
    ...common,
    // The worker is referenced relative to the module, wherever it is served.
    base: "./",
    plugins: composePlugins(env),
    // As modules, so the worker loads each compressor as it needs it.
    worker: { format: "es" as const },
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
