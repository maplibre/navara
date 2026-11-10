import path from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      // The plugin under test is served from source, so plugin edits need no
      // rebuild. Other @navaramap packages (and WASM) still use their dist.
      "@navaramap/maplibre-style": path.join(
        import.meta.dirname,
        "../src/index.ts",
      ),
    },
    // Linked dist builds would otherwise each pull their own copy of three.
    dedupe: ["three"],
  },
  // The fixture checkout is served but never edited by hand, and the tests
  // write their outputs into it.
  server: {
    watch: {
      ignored: [
        "**/maplibre-gl-js/**",
        "**/render/results.*",
        "**/test-results/**",
      ],
    },
  },
  optimizeDeps: { entries: ["lib/test-page.html"] },
});
