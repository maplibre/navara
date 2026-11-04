import ThreeView, {
  Color,
  fetchFontFamilyFromCss,
  TERRARIUM_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { TERRAIN_DATASETS } from "../../../helpers/constants";

export type CustomDescriptions = DefaultDescriptions;

// Sea-floor stations from Suruga Bay down the Suruga Trough to the Nankai
// Trough, deepening from about -80 m to about -3600 m.
const STATIONS: { name: string; coordinates: [number, number] }[] = [
  { name: "Numazu", coordinates: [138.83, 35.08] },
  { name: "Suruga Bay N", coordinates: [138.7, 34.98] },
  { name: "Suruga Bay", coordinates: [138.62, 34.85] },
  { name: "Bay mouth", coordinates: [138.55, 34.65] },
  { name: "Suruga Trough", coordinates: [138.45, 34.4] },
  { name: "Nankai Trough", coordinates: [138.35, 34.15] },
  { name: "Nankai Trough S", coordinates: [138.2, 33.95] },
];

// Oblique views down the transect from Suruga Bay, and straight-down views
// over the deepest station.
const BAY_VIEW = { lng: 138.56, lat: 34.8, heading: 200, pitch: -25 };
const TROUGH_VIEW = { lng: 138.2, lat: 33.95, heading: 0, pitch: -90 };
const CAMERA_PRESETS = {
  "Bay 2000 m": { ...BAY_VIEW, height: 2000 },
  "Bay 5000 m": { ...BAY_VIEW, height: 5000 },
  "Bay 12000 m": { ...BAY_VIEW, height: 12000 },
  "Trough 1500 m": { ...TROUGH_VIEW, height: 1500 },
  "Trough 5000 m": { ...TROUGH_VIEW, height: 5000 },
};

export const run = async (view: ThreeView<CustomDescriptions>) => {
  view.addPlugin(new DefaultPlugin());

  await view.init();

  view.globe.color = new Color().setStyle("#1b2a3a");
  view.atmosphere.date = new Date("2026-07-16T02:00:00Z");
  view.addLight({ ambient: { intensity: 0.6 } });
  view.addLight({ sun: { intensity: 2.0 } });

  view.addFontFamily(
    await fetchFontFamilyFromCss(
      "Arsenal",
      "https://fonts.googleapis.com/css2?family=Arsenal:wght@700",
    ),
  );

  view.setCamera({ ...CAMERA_PRESETS["Bay 5000 m"], roll: 0 });

  const stations = view.addSource({
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: STATIONS.map(({ name, coordinates }) => ({
        type: "Feature" as const,
        properties: { name },
        geometry: { type: "Point" as const, coordinates },
      })),
    },
  });
  const transect = view.addSource({
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: STATIONS.map(({ coordinates }) => coordinates),
      },
    },
  });

  // Around Japan the tiles hold the ocean floor only up to zoom 10; deeper
  // zooms read 0 over the ocean, so the source stops there.
  const dem = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.awsTerrarium.url,
    maxZoom: 10,
    tileSize: 256,
    elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  });
  const terrainLayer = view.addLayer({ type: "terrain", source: dem });
  view.addLayer({ type: "raster", source: dem, hillshade: {} });

  // Sea-floor features clamped to the terrain, below the ellipsoid.
  view.addLayer({
    type: "vector",
    source: transect,
    polyline: {
      color: new Color().setStyle("#0091ff"),
      width: 3,
      clampToGround: true,
    },
  });
  const stationLayer = view.addLayer({
    type: "vector",
    source: stations,
    point: {
      color: new Color().setStyle("#ff6b2c"),
      size: 16,
      sizeInMeters: false,
      clampToGround: true,
    },
    text: {
      font: "Arsenal",
      color: new Color().setStyle("#ffffff"),
      size: 20,
      sizeInMeters: false,
      clampToGround: true,
      anchor: "top",
      outlineColor: new Color().setStyle("#000000"),
      outlineWidth: 3,
      declutter: false,
    },
  });
  stationLayer.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => ({ text: (properties?.["name"] as string) ?? "" }),
      { filters: ["name"] },
    );
  });

  view.attribution?.add([TERRAIN_DATASETS.awsTerrarium]);

  const pane = new Pane({ title: "Ocean floor" });
  const params = { exaggeration: 1, relativeHeight: 0 };
  pane
    .addBinding(params, "exaggeration", { min: 0, max: 5, step: 0.1 })
    .on("change", (ev) => {
      terrainLayer.update({ terrain: { exaggeration: ev.value } });
    });
  pane
    .addBinding(params, "relativeHeight", { min: -4000, max: 4000, step: 100 })
    .on("change", (ev) => {
      terrainLayer.update({
        terrain: { exaggerationRelativeHeight: ev.value },
      });
    });

  const camera = pane.addFolder({ title: "Camera" });
  for (const [title, preset] of Object.entries(CAMERA_PRESETS)) {
    camera
      .addButton({ title })
      .on("click", () => view.setCamera({ ...preset, roll: 0 }));
  }
};
