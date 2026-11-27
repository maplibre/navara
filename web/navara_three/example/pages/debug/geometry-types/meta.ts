import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_geojson/src/geometry/process.rs",
    "crates/navara_geojson/src/tile/geometry.rs",
    "crates/navara_mvt/src/geometry/process.rs",
    "crates/navara_parser/src/mvt/parse.rs",
    "crates/navara_parser/src/line_placement.rs",
    "crates/navara_geometry/src/ring.rs",
    "crates/navara_feature_component/src/geometry_builder.rs",
    "web/navara_three/src/mesh/sdfText/linePlacement.ts",
    "web/navara_three/src/event/feature.ts",
    "crates/navara_geometry/**",
    "crates/navara_geojson/**",
    "crates/navara_feature_component/**",
    "crates/navara_feature/**",
    "crates/navara_parser/**",
  ],
  lookFor:
    'The vector-layer `geometryTypes` option on inline GeoJSON (direct and clamped/tiled paths) and PLATEAU MVT: each pane combination rebuilds the layer, derived boundary lines and points take the fill\'s evaluated color, a click highlights every representation of the picked feature, the `stack` layer on the same source still gets its own features, and text/billboard `placement: "line"` anchors follow the lines.',
  params: {},
  evidenceFor: [801, 824],
} satisfies DevPageMeta;
