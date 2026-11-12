import ThreeView, { Color } from "@navaramap/three";
import type { Text3DMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

import { addButton, addCheckbox, addSwitch } from "../../../../helpers/button";
import {
  FONT_DATASETS,
  TERRAIN_DATASETS,
  TILES_3D_DATASETS,
  TILE_DATASETS,
} from "../../../../helpers/constants";
import { initializeExample } from "../../../../helpers/initialize";

const view = new ThreeView<DefaultDescriptions>({ shadow: true });

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);

await view.init();

// `applyColor` keeps the sun white; its direction follows `atmosphere.date`.
view.addLight({
  sun: {
    castShadow: true,
    applyColor: true,
    intensity: 2,
    shadowIntensity: 0.6,
  },
});
view.atmosphere.date = new Date("2024-11-01T03:00:00Z");

view.setCamera({
  lng: 139.7488,
  lat: 35.6866,
  height: 1390,
  heading: 47.5,
  pitch: -28.6,
  roll: 0,
});
view.camera.fov = 20;

// The buildings sit on Re:Earth Terrain heights, so the terrain keeps their bases on the ground.
const terrain = view.addSource({
  type: "quantized-mesh",
  url: TERRAIN_DATASETS.reearthQuantizedMesh.url,
  maxZoom: 18,
  requestVertexNormals: true,
});
view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { castShadow: true, receiveShadow: true },
});

const osm = view.addSource({
  type: "raster-tile",
  url: TILE_DATASETS.openstreetmap.url,
  maxZoom: 18,
});
view.addLayer({ type: "raster", source: osm });

const source = view.addSource({
  type: "3d-tiles",
  url: TILES_3D_DATASETS.reearthBuildings.url,
});
view.addLayer({
  type: "3d-tiles",
  source,
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
    font: FONT_DATASETS.LineSeedJP.url,
    size: 107.5,
    depth: 75,
    color: new Color().setStyle("#cc0000"),
    // Keeps the faces turned away from the sun red instead of near black.
    emissiveColor: new Color().setStyle("#ff0000"),
    emissiveIntensity: 0.29,
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
  { label: "LINE Seed JP", dataset: FONT_DATASETS.LineSeedJP },
  { label: "Montserrat", dataset: FONT_DATASETS.Montserrat },
  { label: "Roboto", dataset: FONT_DATASETS.Roboto },
  { label: "Borel", dataset: FONT_DATASETS.Borel },
];
// The text keeps its current font until the new one has loaded.
addSwitch(
  fonts.map((font) => font.label),
  0,
  (index) => text.update({ text3D: { font: fonts[index].dataset.url } }),
);

addCheckbox("Bevel", false, (bevelEnabled) =>
  text.update({ text3D: { bevelEnabled } }),
);

const colors = [
  { color: "#cc0000", emissiveColor: "#ff0000" },
  { color: "#0078d4", emissiveColor: "#0091ff" },
];
let colorIndex = 0;
addButton("Color", () => {
  colorIndex = (colorIndex + 1) % colors.length;
  const { color, emissiveColor } = colors[colorIndex];
  text.update({
    text3D: {
      color: new Color().setStyle(color),
      emissiveColor: new Color().setStyle(emissiveColor),
    },
  });
});

view.attribution?.add([
  TERRAIN_DATASETS.reearthQuantizedMesh,
  TILE_DATASETS.openstreetmap,
  TILES_3D_DATASETS.reearthBuildings,
  ...fonts.map((font) => font.dataset),
]);

initializeExample(view, [text]);
