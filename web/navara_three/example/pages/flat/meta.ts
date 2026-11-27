import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_layer/src/terrain.rs",
    "crates/navara_tile_component/src/terrain_tile.rs",
    "web/navara_three/src/mesh/tile/**",
  ],
  lookFor:
    "A terrain layer with `ellipsoid` (no DEM) under OSM tiles, PLATEAU buildings lowered by `height: -50`, and a draped GeoJSON line and polygon near Mt. Fuji: the ground should be a smooth ellipsoid that casts and receives shadows, with the imagery and vectors on it.",
  params: {},
  evidenceFor: [127, 327],
} satisfies DevPageMeta;
