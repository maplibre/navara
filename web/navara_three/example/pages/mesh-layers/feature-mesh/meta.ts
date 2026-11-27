import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/meshes/PolygonMeshDesc.ts",
    "web/navara_three_default_descs/src/meshes/PolylineMeshDesc.ts",
    "web/navara_three_default_descs/src/meshes/featureMeshes.ts",
    "web/navara_three_default_descs/src/meshes/featurePositions.ts",
    "web/navara_three_default_descs/src/meshes/featureStyle.ts",
    "web/navara_three_default_descs/src/meshes/groundVolume.ts",
    "crates/navara_wasm_api/src/polygon.rs",
    "crates/navara_wasm_api/src/polyline.rs",
    "crates/navara_geometry/src/ground_volume.rs",
    "crates/navara_geometry/src/polygon/**",
    "web/navara_three/src/mesh/featureMesh.ts",
  ],
  lookFor:
    "A polygon editor near Mt. Fuji built on `PolygonMeshDesc` and `PolylineMeshDesc`: clicking the terrain draws a ring (cursor marker and dashed preview edge follow the mouse), the closed polygon can be selected, restyled, extruded or draped, moved by its transform fields and deleted, and shapes stay on the terrain when the exaggeration changes.",
  params: {},
  evidenceFor: [852],
} satisfies DevPageMeta;
