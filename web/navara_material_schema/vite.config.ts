import { readFileSync } from "node:fs";

import { defineConfig } from "vite";

import { commonConfig } from "../vite.config.common";

// The version scripts/set-version.mjs stamps before a release build, so the
// published schema names the engine version it describes.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig((env) => {
  const common = commonConfig("NavaraMaterialSchema", env);
  return {
    ...common,
    define: {
      ...common.define,
      __MATERIAL_SCHEMA_VERSION__: JSON.stringify(version),
    },
    test: { environment: "node" },
  };
});
