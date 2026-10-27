import { defineConfig } from "vite";
import tsconfig from "vite-tsconfig-paths";

import { commonConfig, composePlugins, dts } from "../vite.config.common";

export default defineConfig((env) => {
  const common = commonConfig("NavaraWorker", env);
  return {
    ...common,
    plugins: composePlugins(env, [
      tsconfig({ configNames: ["tsconfig.build.json"] }),
      dts({ tsconfigPath: "./tsconfig.build.json" }),
    ]),
  };
});
