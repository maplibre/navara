import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_camera/src/fit_bounds.rs",
    "crates/navara_camera/src/system.rs",
    "web/navara_three/src/fitBounds.ts",
  ],
  lookFor:
    "After each fit settles, every red marker is inside the dashed padding rectangle: the readout's margins are 0 px on one axis and equal on the other. Osaka–Tokyo–Sendai at heading 45 resolves `false` at pitch -20 and fits at -45.",
  params: {
    initial:
      "Index of a set to fit right after `init()`, before the first frame (heading 0, pitch -90, padding 40); the status then reads `initial: true`.",
  },
  evidenceFor: [1026, 1034],
} satisfies DevPageMeta;
