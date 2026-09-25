import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import type { FeatureCollection } from "geojson";

import { TERRAIN_DATASETS, TILE_DATASETS } from "../../../helpers/constants";
import { atZoneTime } from "../../../helpers/control";

const run = async () => {
  const view = new ThreeView<DefaultDescriptions>({
    debug: true,
    shadow: true,
  });

  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const attribution = view.attribution;

  await view.init();

  const defaultAtmospheres = defaultPlugin.addDefaultPhotorealScene();
  defaultAtmospheres.sun.update({
    sun: { intensity: 1, castShadow: true },
  });

  view.atmosphere.date = atZoneTime(view.atmosphere.date, 8);

  view.setCamera({
    lng: 139.775,
    lat: 35.621,
    height: 1000,
    heading: 0,
    pitch: -55,
    roll: 0,
  });

  // Selective bloom effect
  const bloomEffect = view.addEffect({
    selectiveBloom: {
      strength: 4.0,
      radius: 0.5,
      threshold: 0.0,
    },
  });

  // GeoJSON points with bloom (Odaiba area landmarks)
  const odaibaPoints: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "A" },
        geometry: { type: "Point", coordinates: [139.775, 35.628] },
      },
      {
        type: "Feature",
        properties: { name: "B" },
        geometry: { type: "Point", coordinates: [139.777, 35.63] },
      },
      {
        type: "Feature",
        properties: { name: "C" },
        geometry: { type: "Point", coordinates: [139.773, 35.626] },
      },
    ],
  };

  const odaibaSource = view.addSource({
    type: "geojson",
    data: odaibaPoints,
  });
  view.addLayer({
    type: "vector",
    source: odaibaSource,
    point: {
      size: 100,
      sizeInMeters: true,
      clampToGround: true,
      color: new Color().setHex(0x0066ff),
      center: { x: 0, y: -0.5 },
      effectIds: [bloomEffect.id],
      emissiveIntensity: 0.5,
    },
  });

  // Base layers
  const terrainDem = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    maxZoom: 15,
    minZoom: 5,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  });
  view.addLayer({
    type: "terrain",
    source: terrainDem,
    terrain: {
      castShadow: true,
      receiveShadow: true,
    },
  });

  view.addLayer({
    type: "raster",
    source: terrainDem,
    hillshade: {},
  });

  const openstreetmap = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 23,
  });
  view.addLayer({
    type: "raster",
    source: openstreetmap,
  });

  attribution?.add([TILE_DATASETS.openstreetmap, TERRAIN_DATASETS.gsi]);
};

run();
