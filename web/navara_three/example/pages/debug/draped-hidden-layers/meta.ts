import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_tile/src/tile/system.rs",
    "crates/navara_tile/src/raster/**",
    "web/navara_three/src/mesh/tile/index.ts",
    "web/navara_three/src/mesh/tile/rasterDrapeResolver.ts",
  ],
  lookFor:
    'Each band layer draws only in its own lettered column, and "overflowErrors" stays 0 while "shown" fits in "rasterSlots" (band B hidden). Toggling layers reassigns the slots: the shown bands keep their own columns, and showing one more layer than fits drops only the topmost band and counts the "Too many layers draped" error.',
  params: {},
  evidenceFor: [1024, 1037],
} satisfies DevPageMeta;
