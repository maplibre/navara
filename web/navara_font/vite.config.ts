import { defineConfig } from "vite";

import { commonConfig } from "../vite.config.common";

export default defineConfig((env) => {
  const common = commonConfig("NavaraFont", env);
  return {
    ...common,
    build: {
      ...common.build,
      rollupOptions: {
        ...common.build.rollupOptions,
        // The app's instance: a bundled copy would be a second three.
        external: [
          ...(common.build.rollupOptions.external as string[]),
          "three",
        ],
      },
    },
  };
});
