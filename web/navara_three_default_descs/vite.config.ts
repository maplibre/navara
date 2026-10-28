import path from "path";

import { defineConfig, normalizePath } from "vite";
import glsl from "vite-plugin-glsl";
import tsconfig from "vite-tsconfig-paths";

import { commonConfig, composePlugins, dts } from "../vite.config.common";

export default defineConfig((env) => {
  const common = commonConfig("NavaraDefaultLayers", env);
  return {
    ...common,
    plugins: composePlugins(env, [
      tsconfig({ configNames: ["tsconfig.build.json"] }),
      glsl(),
      dts({
        tsconfigPath: "./tsconfig.build.json",
        bundleTypes: true,
      }),
    ]),
    resolve: {
      ...common.resolve,
      alias: {
        "@shaders": normalizePath(path.resolve(__dirname, "../../shaders")),
      },
    },
    build: {
      ...common.build,
      lib: {
        ...common.build.lib,
        formats: ["es"],
      },
      rollupOptions: {
        ...common.build.rollupOptions,
        external: ["three", "postprocessing", "@navaramap/three"],
      },
    },
  };
});
