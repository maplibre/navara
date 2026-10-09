import ThreeView, {
  Color,
  TERRARIUM_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { TERRAIN_DATASETS, TILE_DATASETS } from "../../../helpers/constants";
import { addDateControl, atZoneDate } from "../../../helpers/control";

export type CustomDescriptions = DefaultDescriptions;

// Mt. Fuji summit.
const SUMMIT = { lng: 138.7274, lat: 35.3606 };

export const run = async (view: ThreeView<CustomDescriptions>) => {
  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  await view.init();

  view.globe.color = new Color().setHex(0xcccccc);
  defaultPlugin.addDefaultPhotorealScene();
  view.toneMappingExposure = 10;

  const terrain = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.mapterhorn.url,
    maxZoom: 18,
    tileSize: 512,
    elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  });
  const terrainLayer = view.addLayer({
    type: "terrain",
    source: terrain,
    terrain: { castShadow: true, receiveShadow: true, exaggeration: 2 },
  });
  view.addLayer({
    type: "raster",
    source: terrain,
    hillshade: {},
  });

  const eox = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.eox.url,
    maxZoom: 15,
  });
  view.addLayer({ type: "raster", source: eox });

  const photo = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.gsiSeamlessphoto.url,
    maxZoom: 18,
    minZoom: 10,
  });
  view.addLayer({ type: "raster", source: photo });

  // A ground-clamped marker on the summit follows the exaggerated surface.
  const summit = view.addSource({
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [SUMMIT.lng, SUMMIT.lat] },
        },
      ],
    },
  });
  view.addLayer({
    type: "vector",
    source: summit,
    point: {
      size: 300,
      sizeInMeters: true,
      clampToGround: true,
      color: new Color().setHex(0xff6b2c),
      center: { x: 0, y: -0.5 },
    },
  });

  view.setCamera({
    lng: 138.59,
    lat: 35.22,
    height: 9000,
    heading: 40,
    pitch: -12,
    roll: 0,
  });

  view.attribution?.add([
    TERRAIN_DATASETS.mapterhorn,
    TILE_DATASETS.eox,
    TILE_DATASETS.gsiSeamlessphoto,
  ]);

  const pane = new Pane({ title: "Terrain exaggeration" });
  const params = {
    exaggeration: 2,
    relativeHeight: 0,
    summitHeight: 0,
  };
  pane
    .addBinding(params, "exaggeration", { min: 0, max: 5, step: 0.1 })
    .on("change", (ev) => {
      terrainLayer.update({ terrain: { exaggeration: ev.value } });
    });
  pane
    .addBinding(params, "relativeHeight", { min: 0, max: 4000, step: 100 })
    .on("change", (ev) => {
      terrainLayer.update({
        terrain: { exaggerationRelativeHeight: ev.value },
      });
    });
  // Height queries report the exaggerated surface.
  pane.addBinding(params, "summitHeight", {
    readonly: true,
    label: "summit height (m)",
  });
  view.observeTerrainHeightAt(SUMMIT, (height) => {
    params.summitHeight = height;
    pane.refresh();
  });

  addDateControl(
    view,
    pane,
    atZoneDate(view.atmosphere.date, {
      month: 7,
      date: 1,
      hours: 7,
      minutes: 0,
    }),
  );
};
