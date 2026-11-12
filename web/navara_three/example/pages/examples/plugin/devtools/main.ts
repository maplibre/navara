import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { DevtoolsPlugin } from "@navaramap/three-plugins";

import {
  TERRAIN_DATASETS,
  TILE_DATASETS,
  TILES_3D_DATASETS,
  VECTOR_DATASETS,
} from "../../../../helpers/constants";
import { initializeExample } from "../../../../helpers/initialize";

const view = new ThreeView<DefaultDescriptions>({ shadow: true });

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
// Devtools must be added before init() so they see every layer. Press ` to hide the panel.
view.addPlugin(new DevtoolsPlugin());

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
  model: {
    color: new Color().setStyle("#ffffff"),
    castShadow: true,
    receiveShadow: true,
  },
});

view.attribution?.add([
  TERRAIN_DATASETS.gsi,
  TILE_DATASETS.openstreetmap,
  VECTOR_DATASETS.gsiExperimentalVector,
  TILES_3D_DATASETS.plateauChiyoda,
]);

initializeExample(view);
