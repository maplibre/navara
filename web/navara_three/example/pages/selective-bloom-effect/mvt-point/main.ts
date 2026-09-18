import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

import {
  MVT_DATASETS,
  TERRAIN_DATASETS,
  TILE_DATASETS,
} from "../../../helpers/constants";
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

  // Camera position for Wakayama
  view.setCamera({
    lng: 135.18,
    lat: 34.07,
    height: 15000,
    heading: 0,
    pitch: -45,
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

  // MVT point with bloom (Wakayama facilities)
  const wakayamaGenSource = view.addSource({
    type: "vector-tile",
    url: MVT_DATASETS.plateauWakayamaGen.url,
    maxZoom: 16,
  });
  const layer = view.addLayer({
    type: "vector",
    source: wakayamaGenSource,
    point: {
      size: 500,
      sizeInMeters: true,
      clampToGround: true,
      color: new Color().setHex(0xffcc00),
      center: { x: 0, y: -0.5 },
      effectIds: [bloomEffect.id],
      emissiveIntensity: 0.5,
    },
  });

  layer.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        const type = properties?.["備考"] as string;

        const color = (() => {
          if (type === "陸上競技場") return new Color().setHex(0x0000ff);
          if (type?.endsWith("河川敷")) return new Color().setHex(0x00ff00);
          return new Color().setHex(0xffcc00);
        })();

        return { color };
      },
      { filters: ["備考"] },
    );
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

  attribution?.add([
    TILE_DATASETS.openstreetmap,
    TERRAIN_DATASETS.gsi,
    MVT_DATASETS.plateauWakayamaGen,
  ]);
};

run();
