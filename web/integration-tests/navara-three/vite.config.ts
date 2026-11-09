import { resolve } from "path";

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        multiView: resolve(__dirname, "multi-view.html"),
      },
    },
  },
});
