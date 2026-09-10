import { defineConfig } from "vite";

import { commonConfig } from "../vite.config.common";

export default defineConfig((env) => {
  const common = commonConfig("NavaraThreeCSM", env);
  return {
    ...common,
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
