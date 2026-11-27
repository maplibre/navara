import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: ["web/navara_three_plugins/src/OverlayPlugin*"],
  lookFor:
    'OverlayPlugin on an idle map (`animation: false`), camera left still: "Move marker" and "Move from postRender" move the red marker at once, and "onUpdate calls" and "rendered frames" go up by about one per click and stay put otherwise.',
  params: {},
  evidenceFor: [1031],
} satisfies DevPageMeta;
