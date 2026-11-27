import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/lineDash/**",
    "shaders/glsl/chunks/line_dash_pars_fragment.glsl",
    "crates/navara_wasm_api/src/line_dash.rs",
    "web/navara_three/src/mesh/polyline*",
    "web/navara_three/src/mesh/nvLineGeometry*",
    "shaders/glsl/*olyline*",
    "web/navara_three/src/material/enhancer/polyline/**",
    "web/navara_three_default_descs/src/meshes/PolylineMeshDesc.ts",
  ],
  lookFor:
    "One row per `dashArray`/`cap` setting and one column per way a polyline is drawn (clamped layer, 3D layer, clamped and 3D `PolylineMeshDesc`): the pattern stays continuous across bends and the sharp corner, caps show correctly at line ends (zero-length dashes only with round caps), and the equator lines keep the pattern over their full length at every camera preset.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
