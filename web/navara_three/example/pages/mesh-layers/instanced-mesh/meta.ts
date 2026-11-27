import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_default_descs/src/meshes/Instanced*",
    "web/navara_three/src/core/InstancedMeshDesc.ts",
    "web/navara_three/src/mesh/instanced.ts",
  ],
  lookFor:
    "Clusters of instanced boxes (buildings), spheres, planes, cylinders and animated glTF models on terrain: the pane's Add / Remove First / Randomize Colors buttons change each cluster's instances in place without disturbing the others, and the glTF animation keeps playing.",
  params: {},
  evidenceFor: [502, 580, 595],
} satisfies DevPageMeta;
