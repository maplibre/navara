import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_cesium3dtiles",
    "crates/navara_cesiumtiles",
    "crates/navara_b3dm",
    "crates/navara_glb",
    "crates/navara_bin",
    "crates/navara_parser/src/cesium3dtiles/**",
    "web/navara_three/src/evaluations/**",
    "web/navara_three/src/batchTexture/**",
  ],
  lookFor:
    "PLATEAU Shinjuku buildings (3D Tiles 1.0) over GSI terrain, colored and hidden per height bucket by a feature evaluator; a color map or threshold colors, the bucket toggles and Remove/Add Layer should restyle or rebuild the tileset without stale colors.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
