import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/DrapedMesh.ts",
    "web/navara_three_default_descs/src/meshes/BoxMeshDesc.ts",
    "web/navara_three_default_descs/src/meshes/CylinderMeshDesc.ts",
  ],
  lookFor:
    "A BoxMeshDesc and a CylinderMeshDesc near Mt. Fuji with `draped: true` (re-added when toggled in the pane): draped, each should be clamped onto the GSI terrain as a footprint shaded with the terrain normal; undraped, it should stand as a 10 km tall solid that casts a shadow.",
  params: {},
  evidenceFor: [494, 765, 852],
} satisfies DevPageMeta;
