import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_plugins/src/OverlayPlugin*",
    "web/navara_three_plugins/src/PersonViewPlugin*",
  ],
  lookFor:
    "DOM markers for Japanese landmarks track their positions from OverlayPlugin.onUpdate over Google Photorealistic 3D Tiles, hide when out of range (maxDistance 100 km) and fade with distance; clicking a marker teleports the PersonViewPlugin character there.",
  params: {},
  evidenceFor: [569, 629],
} satisfies DevPageMeta;
