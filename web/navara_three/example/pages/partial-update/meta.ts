import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/source.ts",
    "web/navara_three/src/layer.ts",
    "web/navara_three/src/layersManager.ts",
    "crates/navara_source",
    "crates/navara_layer",
    "web/navara_three/src/mesh/tile/**",
    "web/navara_three/src/tasks/*errain*",
    "web/navara_three/src/tasks/upsample*",
    "crates/navara_tile",
    "crates/navara_tile_component",
    "crates/navara_quadtree",
    "crates/martini",
  ],
  lookFor:
    'One folder per layer type (raster tile, GeoJSON polygon, B3DM, PNTS, MVT polygon) updates the layer or its source in place: appearance, source URL, min/max zoom and tms apply without a reload, and "delete source" / re-add and "fly to" work. Look for stale tiles or features after a URL or zoom change, and attribution left behind after a delete.',
  params: {},
  evidenceFor: [371, 667],
} satisfies DevPageMeta;
