import { defineConfig } from "vite";

import { commonConfig } from "../vite.config.common";

export default defineConfig((env) => ({
  ...commonConfig("NavaraMaterialSchema", env),
  test: { environment: "node" },
}));
