import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/orchestrators/RenderPassOrchestrator.ts",
    "web/navara_worker/src/pool.ts",
    "web/navara_three/src/inMemoryBufferStore.ts",
    "crates/navara_ecs/src/memory*",
    "crates/navara_memory/**",
    "crates/navara_buffer_store/**",
  ],
  lookFor:
    "Initialize and Dispose buttons create and `dispose()` a full ThreeView (raster, terrain with shadows, hillshade): after Dispose the canvas and workers are released without console errors, and Initialize again brings the map back.",
  params: {},
  evidenceFor: [602],
} satisfies DevPageMeta;
