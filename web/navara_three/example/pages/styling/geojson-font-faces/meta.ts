import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_font/**",
    "crates/navara_wasm_font_worker/**",
    "web/navara_three/src/mesh/sdfText/**",
    "shaders/glsl/sdfText*",
  ],
  lookFor:
    "World city names in their native scripts from a multi-script @font-face family whose face files load lazily per unicode range; every script should shape correctly (Arabic joined, CJK present), and size, maxWidth, lineHeight, letterSpacing and textAlign should relayout the labels.",
  params: {},
  evidenceFor: [501, 672, 688, 860, 900],
} satisfies DevPageMeta;
