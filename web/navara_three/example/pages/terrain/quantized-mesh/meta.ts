import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/tile/**",
    "crates/navara_tile",
    "crates/navara_tile_component",
    "crates/martini",
    "crates/navara_quadtree",
    "crates/navara_source",
    "web/navara_three/src/tasks/*errain*",
    "web/navara_three/src/tasks/upsample*",
    "web/navara_three_plugins/src/CesiumIonPlugin*",
    "crates/navara_tile_component/src/terrain/quantized_mesh_data.rs",
    "crates/navara_wasm_worker/src/task/construct_quantized_mesh_terrain_mesh.rs",
  ],
  lookFor:
    "Quantized-mesh terrain from Re:Earth or Cesium Ion (PLATEAU terrain) under EOX and GSI imagery; the type field swaps the terrain live and the delete button falls back to the flat ellipsoid, all without missing tiles or a reset view.",
  params: {},
  evidenceFor: [630, 642, 652],
} satisfies DevPageMeta;
