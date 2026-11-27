import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/core/MeshDesc.ts",
    "web/navara_three/src/core/InstancedMeshDesc.ts",
    "web/navara_three/src/terrain/terrainHeightEvent.ts",
    "web/navara_three_api/src/frames.ts",
    "web/navara_three_default_descs/src/meshes/GLTFModelDesc.ts",
    "web/navara_three_default_descs/src/meshes/InstancedGltfModelMeshDesc.ts",
    "web/navara_three_default_descs/src/meshes/SplatMeshDesc/**",
  ],
  lookFor:
    "Every built-in mesh descriptor is placed twice on a slope, once with `geodetic` (north column) and once with the legacy `matrixWorld` + local TRS (south column): the pane's heading, pitch, roll, scale, height and heightReference move the north column, and with matched values the two columns line up and sit on the ground.",
  params: {},
  evidenceFor: [785],
} satisfies DevPageMeta;
