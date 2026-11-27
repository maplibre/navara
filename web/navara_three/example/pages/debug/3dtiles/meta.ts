import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_parser/src/cesium3dtiles/**",
    "crates/navara_cesium3dtiles/**",
    "crates/navara_cesiumtiles/**",
    "crates/navara_b3dm/**",
    "crates/navara_pnts/**",
    "crates/navara_glb/**",
    "crates/navara_bin/**",
    "web/navara_three/src/mesh/model*",
    "web/navara_three/src/event/features/model*",
    "web/navara_three/src/event/features/pnts.ts",
    "web/navara_three/src/event/dataRequester.ts",
    "web/navara_three/src/loaders/**",
    "web/navara_three/src/tasks/decodeDraco*",
    "web/navara_three/src/batchTexture/**",
  ],
  lookFor:
    "Each 3D Tiles dataset (Cesium specs, 3d-tiles-samples: b3dm, i3dm, pnts, glTF content, metadata) loads framed on its root bounding volume with its textures and no response >= 400; the pane shows the expected note, version and feature count, and a click highlights the picked feature and lists its properties.",
  params: {
    ds: "dataset to load, as `<group>/<name>` from datasets.ts (default: the first)",
    url: "a tileset.json (or glTF) URL to load instead of a listed dataset",
  },
  evidenceFor: [979, 989, 991, 1002, 1004, 1015],
} satisfies DevPageMeta;
