import ThreeView, { Color } from "@navaramap/three";
import type { Text3DMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";

import { addCheckbox } from "../../../../helpers/button";
import { initializeExample } from "../../../../helpers/initialize";

const ASSETS = import.meta.env.BASE_URL;

const view = new ThreeView<DefaultDescriptions>({ shadow: true });

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);

await view.init();

view.atmosphere.date = new Date("2024-11-01T03:00:00Z");
view.addLight({ ambient: { intensity: 0.5 } });
view.addLight({ sun: { intensity: 2, applyColor: true, castShadow: true } });

view.setCamera({
  lng: 139.7488,
  lat: 35.6866,
  height: 1390,
  heading: 38,
  pitch: -26,
  roll: 0,
});
view.camera.fov = 20;

const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain",
  maxZoom: 18,
  requestVertexNormals: true,
});
view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { castShadow: true, receiveShadow: true },
});

const basemap = await tilejson.addSource({
  type: "raster-tile",
  url: "https://papers.reearth.land/styles/papers-light/tilejson.json",
});
view.addLayer({ type: "raster", source: basemap });

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

const text = view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "東京 -TOKYO-",
    font: `${ASSETS}fonts/lineseedjp/LINESeedJP-Bold.ttf`,
    size: 107.5,
    depth: 75,
    color: new Color().setStyle("#0091ff"),
    bevelThickness: 10,
    bevelSize: 6,
    castShadow: true,
  },
  geodetic: {
    lng: 139.766,
    lat: 35.70444,
    height: 100,
    heading: 177.5,
    pitch: 0,
    heightReference: "terrain",
  },
});

addCheckbox("Bevel", false, (bevelEnabled) =>
  text.update({ text3D: { bevelEnabled } }),
);

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

initializeExample(view, [text]);
