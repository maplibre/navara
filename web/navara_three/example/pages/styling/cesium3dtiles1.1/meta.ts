import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/model*",
    "web/navara_three/src/mesh/modelBatchIds*",
    "web/navara_three/src/material/enhancer/model/**",
    "crates/navara_cesium3dtiles",
    "crates/navara_parser/src/cesium3dtiles/**",
    "web/navara_three/src/evaluations/**",
    "web/navara_three/src/batchTexture/**",
    "web/navara_three/src/pick/**",
  ],
  lookFor:
    "PLATEAU Ajigasawa buildings as 3D Tiles 1.1 glTF content, colored per height by a feature evaluator on `bldg:measuredHeight`; clicking a building turns it cyan, so a wrong feature ID or metadata lookup shows as the wrong building or none highlighting.",
  params: {},
  evidenceFor: [528],
} satisfies DevPageMeta;
