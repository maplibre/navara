import ThreeView, { Color } from "@navaramap/three";
import type { Text3DMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";

import { addButton, addCheckbox, addSwitch } from "../../../../helpers/button";
import { initializeExample } from "../../../../helpers/initialize";

const ASSETS = import.meta.env.BASE_URL; // "/examples/" on navara.world

const view = new ThreeView<DefaultDescriptions>({ shadow: true });

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);

await view.init();

view.atmosphere.date = new Date("2024-11-01T03:00:00Z");
view.addLight({ ambient: { intensity: 0.5 } });
// `applyColor` keeps the sun white; its direction follows `atmosphere.date`.
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

// The buildings sit on Re:Earth Terrain heights, so the terrain keeps their bases on the ground.
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
    // Bevel lengths are absolute, so they are set in proportion to `size`.
    bevelThickness: 10,
    bevelSize: 6,
    castShadow: true,
  },
  // The bottom center of the text stands here; `heading` is where its front faces.
  geodetic: {
    lng: 139.766,
    lat: 35.70444,
    height: 100,
    heading: 177.5,
    pitch: 0,
    heightReference: "terrain",
  },
});

const fonts = [
  {
    label: "LINE Seed JP",
    url: `${ASSETS}fonts/lineseedjp/LINESeedJP-Bold.ttf`,
  },
  { label: "Montserrat", url: `${ASSETS}fonts/montserrat/Montserrat-Bold.ttf` },
  { label: "Roboto", url: `${ASSETS}fonts/roboto/Roboto[wdth,wght].ttf` },
  { label: "Borel", url: `${ASSETS}fonts/borel/Borel-Regular.ttf` },
];
// The text keeps its current font until the new one has loaded.
addSwitch(
  fonts.map((font) => font.label),
  0,
  (index) => text.update({ text3D: { font: fonts[index].url } }),
);

addCheckbox("Bevel", false, (bevelEnabled) =>
  text.update({ text3D: { bevelEnabled } }),
);

let color = "#0091ff";
addButton("Color", () => {
  color = color === "#0091ff" ? "#ff6b2c" : "#0091ff";
  text.update({ text3D: { color: new Color().setStyle(color) } });
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

initializeExample(view, [text]);
