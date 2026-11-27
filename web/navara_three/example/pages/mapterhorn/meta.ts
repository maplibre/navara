import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_core/src/terrain/decoder.rs",
    "web/navara_three/src/constants/decoder.ts",
    "crates/navara_geometry/src/terrain/**",
    "crates/navara_tile_component/src/raster_tile.rs",
    "crates/navara_tile/src/tile/**",
  ],
  lookFor:
    "Mapterhorn terrarium DEM (512 px tiles, TERRARIUM_ELEVATION_DECODER) as terrain and hillshade under OSM in New Zealand, lit by a sun from the date pane: the mountains should load without flat or missing tiles while zooming, with the hillshade matching the relief.",
  params: {},
  evidenceFor: [330, 409, 601],
} satisfies DevPageMeta;
