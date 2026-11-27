import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_core/src/globe/**",
    "crates/navara_globe",
    "crates/navara_wasm_types/src/globe.rs",
    "web/navara_three/src/passes/CustomRenderPass.ts",
  ],
  lookFor:
    "The `view.globe` settings (color, hideUnderground, transparent, opacity, wireframe) on a GSI terrain + 3D Tiles scene: each pane control should change the globe live, e.g. a transparent globe shows what is under the ground and hideUnderground hides it again.",
  params: {},
  evidenceFor: [315, 354, 403, 432],
} satisfies DevPageMeta;
