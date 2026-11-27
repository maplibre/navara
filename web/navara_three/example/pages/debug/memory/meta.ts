import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_memory/**",
    "crates/navara_ecs/src/memory*",
    "crates/navara_buffer_store/**",
    "web/navara_three/src/inMemoryBufferStore.ts",
    "web/navara_three/src/utils/fixedGpuFootprint.ts",
    "web/navara_three/src/tileTexture/**",
    "web/navara_three/src/material/enhancer/tileComposite/**",
    "web/navara_three/src/material/macro/tileShader*",
    "web/navara_three/src/**/*illshade*",
    "crates/navara_tile/src/hillshade",
    "shaders/glsl/chunks/hillshade*",
    "web/navara_worker/**",
    "crates/navara_worker*",
    "crates/navara_event*",
    "crates/navara_data_requester/**",
    "crates/navara_wasm/src/event/**",
    "web/navara_three/src/tasks/**",
  ],
  lookFor:
    "Live engine memory stats (WASM buffer bytes, GPU estimates, retained and evicted tiles, SSE) next to browser memory probes over GSI terrain with PLATEAU 3D Tiles or GSI vector tiles: moving the `cacheMB` slider retains or evicts tiles, and the fly-to button reproduces the z4 to z16 descent burst for cold-load and FPS checks.",
  params: {
    dataset:
      "heavy dataset on top of terrain + raster: 3dtiles (default) | mvt; the pane reloads the page to switch",
  },
  evidenceFor: [692, 697, 722],
} satisfies DevPageMeta;
