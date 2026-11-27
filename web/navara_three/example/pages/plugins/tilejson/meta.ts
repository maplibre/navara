import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: ["web/navara_three_plugins/src/TileJsonPlugin*"],
  lookFor:
    "A TileJSON 3.0.0 raster basemap (papers.reearth.land light style) added through TileJsonPlugin.addSource fills a top-down view of Japan; its minzoom/maxzoom reach the source and its attribution string shows in the attribution UI.",
  params: {},
  evidenceFor: [695],
} satisfies DevPageMeta;
