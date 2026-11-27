import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: ["web/navara_three/src/plugins/AttributionPlugin/**"],
  lookFor:
    "The attribution UI lists the active base layer's credits: Google Photorealistic 3D Tiles with per-tile copyrights nested under the source (creditLayerId), or GSI seamlessphoto plus Mapterhorn terrain. Switching the Layer recreates the view and must leave no stale credits; Dark theme restyles the popover via setStyle.",
  params: {},
  evidenceFor: [636],
} satisfies DevPageMeta;
