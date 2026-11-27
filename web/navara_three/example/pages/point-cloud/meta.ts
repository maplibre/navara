import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_pnts",
    "web/navara_three/src/material/enhancer/model/pntsEnhancer/**",
    "web/navara_three/src/loaders/*raco*",
    "web/navara_three/src/tasks/decodeDraco*",
  ],
  lookFor:
    "Two point-cloud 3D Tiles (Yamanashi Kyonaka, PLATEAU Kakegawa castle) over OpenStreetMap, with view buttons and per-layer show, pointSize, height and maxSse in the pane. Look for missing or misplaced points, pointSize not applying, and tiles that do not refine.",
  params: {},
  evidenceFor: [302, 331],
} satisfies DevPageMeta;
