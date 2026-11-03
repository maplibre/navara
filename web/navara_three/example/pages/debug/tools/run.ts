/**
 * Debug tools page: every `@navaramap/three-debug` plugin on one shared
 * panel, over a scene with terrain, imagery, vector tiles and 3D Tiles so
 * each profiler section has something to show. Press ` to hide the panel.
 */
import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

import {
  TERRAIN_DATASETS,
  TILE_DATASETS,
  TILES_3D_DATASETS,
  VECTOR_DATASETS,
} from "../../../helpers/constants";
import { installDebugTools } from "../../../helpers/debugTools";

export const run = async () => {
  const view = new ThreeView<DefaultDescriptions>();
  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);
  installDebugTools(view);
  const attribution = view.attribution;

  await view.init();
  defaultPlugin.addDefaultPhotorealScene();
  view.addLight({ ambient: { intensity: 0.6 } });

  view.setCamera({
    lng: 139.76,
    lat: 35.68,
    height: 3000,
    heading: 20,
    pitch: -40,
    roll: 0,
  });

  const demSource = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
    maxZoom: 15,
    minZoom: 5,
  });
  view.addLayer({ type: "terrain", source: demSource });

  const rasterSource = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 23,
  });
  view.addLayer({ type: "raster", source: rasterSource });

  const vectorSource = view.addSource({
    type: "vector-tile",
    url: VECTOR_DATASETS.gsiExperimentalVector.url,
    maxZoom: 16,
  });
  view.addLayer({
    type: "vector",
    source: vectorSource,
    sourceLayers: ["building"],
    polygon: {
      color: new Color().setStyle("#8899aa"),
      height: 0,
      extrudedHeight: 12,
      clampToGround: false,
    },
  });

  const tilesSource = view.addSource({
    type: "3d-tiles",
    url: TILES_3D_DATASETS.plateauChiyoda.url,
  });
  view.addLayer({
    type: "3d-tiles",
    source: tilesSource,
    model: { show: true, color: new Color().setStyle("#ffffff") },
  });

  attribution?.add([
    TERRAIN_DATASETS.gsi,
    TILE_DATASETS.openstreetmap,
    VECTOR_DATASETS.gsiExperimentalVector,
    TILES_3D_DATASETS.plateauChiyoda,
  ]);
};
