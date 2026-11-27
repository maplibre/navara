import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_worker/src/pool.ts",
    "web/navara_worker/src/recyclingPool.ts",
    "web/navara_font/src/cssFontFamily.ts",
    "web/navara_three_api/src/index.ts",
    "web/navara_worker/**",
  ],
  lookFor:
    "Two independent ThreeViews side by side (terrain + imagery + PLATEAU buildings, and GSI MVT with labels) sharing the page-wide worker pool: both stream tiles after a concurrent init, disposing one leaves the other streaming, and after disposing both a new view initializes again.",
  params: {
    "#a / #b":
      "location hash, not a query parameter: starts only that pane, as the single-view baseline",
  },
  evidenceFor: [918],
} satisfies DevPageMeta;
