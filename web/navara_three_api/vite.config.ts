import dts from "unplugin-dts/vite";
import { defineConfig } from "vite";
import tsconfig from "vite-tsconfig-paths";

import { commonConfig, composePlugins } from "../vite.config.common";

export default defineConfig((env) => {
  const common = commonConfig("NavaraThreeApi", env);
  return {
    ...common,
    plugins: composePlugins(env, [
      tsconfig({ configNames: ["tsconfig.build.json"] }),
      dts({ tsconfigPath: "./tsconfig.build.json" }),
    ]),
    build: {
      ...common?.build,
      rollupOptions: {
        ...common?.build?.rollupOptions,
        external: [
          ...(common.build?.rollupOptions?.external as string[]),
          "three",
        ],
      },
    },
  };
});
