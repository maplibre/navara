import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_geojson/src/tile/densify.rs",
    "crates/navara_core/src/ellipsoid_geodesic.rs",
    "web/navara_three_api/src/ellipsoidGeodesic.ts",
    "crates/navara_geometry/src/polyline/**",
  ],
  lookFor:
    "A continent-scale polyline and polygon drawn both as 3D geometry (red) and draped on the ground (blue): with the pane on `both`, the two follow the same geodesic path instead of the draped one cutting a straight line across the tiles.",
  params: {},
  evidenceFor: [779],
} satisfies DevPageMeta;
