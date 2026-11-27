import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_wasm_font_worker/src/color_raster.rs",
    "crates/navara_wasm_font_worker/src/atlas.rs",
    "shaders/glsl/sdfText*",
    "web/navara_font/**",
    "web/navara_three/src/mesh/sdfText/**",
  ],
  lookFor:
    "World cities labeled with a COLRv1 Noto Color Emoji before their names (the mode picks which emoji), from a multi-face font family loaded per unicode range; emoji should render in color (not as tofu or monochrome) in every mode, and size changes should keep them sharp.",
  params: {},
  evidenceFor: [583, 688],
} satisfies DevPageMeta;
