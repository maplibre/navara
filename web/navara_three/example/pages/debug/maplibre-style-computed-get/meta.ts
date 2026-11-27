import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_wasm_types/src/style_expr.rs",
    "web/navara_maplibre_style/src/engine/RustStyleEngine*",
  ],
  lookFor:
    'Three squares whose fill-color reads a property named by another property (`["get", ["concat", "color_", ["get", "kind"]]]`) come out green (park), blue (water) and orange (road); black squares or `CouldNotParse color null` in the console mean the expression did not see the property.',
  params: {},
  evidenceFor: [1033],
} satisfies DevPageMeta;
