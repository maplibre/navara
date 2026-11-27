import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/polygon*",
    "web/navara_three/src/material/enhancer/polygon/**",
    "web/navara_three/src/evaluations/**",
    "web/navara_three/src/batchTexture/**",
    "shaders/glsl/chunks/batch_texture*",
    "web/navara_three/src/event/features/**",
    "crates/navara_geometry/**",
    "crates/navara_geojson/**",
    "crates/navara_feature_component/**",
    "crates/navara_feature/**",
    "crates/navara_parser/**",
  ],
  lookFor:
    "Every vector layer kind (point, billboard, text, polyline, polygon from GeoJSON and PLATEAU MVT) plus 3D Tiles buildings over GSI terrain and hillshade, in one scene: each draws in place, and the pane's material controls and terrain exaggeration update the matching layer live.",
  params: {},
  evidenceFor: [450, 464, 599, 669, 976],
} satisfies DevPageMeta;
