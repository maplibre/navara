import ThreeView, { Color } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { DevtoolsPlugin, TileJsonPlugin } from "@navaramap/three-plugins";

import { initializeExample } from "../../../../helpers/initialize";

const view = new ThreeView<DefaultDescriptions>({ shadow: true });

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);
// Devtools must be added before init() so they see every layer. Press ` to hide the panel.
view.addPlugin(new DevtoolsPlugin());

await view.init();

defaultPlugin.addDefaultPhotorealScene();
view.addLight({ ambient: { intensity: 0.6 } });
view.atmosphere.date = new Date("2026-07-16T03:00:00Z");

view.setCamera({
  lng: 139.76,
  lat: 35.68,
  height: 3000,
  heading: 20,
  pitch: -40,
  roll: 0,
});

const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain",
  maxZoom: 18,
});
view.addLayer({ type: "terrain", source: terrain });

const basemap = await tilejson.addSource({
  type: "raster-tile",
  url: "https://papers.reearth.land/styles/papers-light/tilejson.json",
});
view.addLayer({ type: "raster", source: basemap });

const transportation = await tilejson.addSource({
  type: "vector-tile",
  url: "https://papers.reearth.land/overture_transportation/tilejson.json",
});
view.addLayer({
  type: "vector",
  source: transportation,
  sourceLayers: ["segment"],
  polyline: {
    color: new Color().setStyle("#0091ff"),
    width: 2,
    clampToGround: true,
  },
});

// Re:Earth Buildings are modeled on Re:Earth Terrain, so their bases meet the ground.
const buildings = view.addSource({
  type: "3d-tiles",
  url: "https://buildings.reearth.land/tileset.json",
});
view.addLayer({
  type: "3d-tiles",
  source: buildings,
  model: {
    color: new Color().setStyle("#ffffff"),
    metalness: 0,
    roughness: 1,
    castShadow: true,
    receiveShadow: true,
  },
});

view.attribution?.add([
  {
    attribution: "© Re:Earth Terrain",
    attributionUrl: "https://terrain.reearth.land/",
  },
  {
    attributionHtml:
      '<a href="https://buildings.reearth.land/">Re:Earth Buildings</a> — Buildings © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, <a href="https://overturemaps.org/">Overture Maps Foundation</a> (ODbL)',
  },
]);

initializeExample(view);
