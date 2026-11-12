import { defineConfig } from "vite";

// The CLI, the one Node entry, built apart from the browser entries so that
// no chunk of theirs can pull in Node modules. Runs after the browser build,
// into the same `dist`.
export default defineConfig({
  // A dependency, resolved at run time as the WASM beside it is.
  ssr: { external: ["@navaramap/engine-api"] },
  build: {
    ssr: true,
    target: "node22",
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: { cli: "./src/cli.ts" },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      output: { chunkFileNames: "[name]-[hash].js" },
    },
  },
});
