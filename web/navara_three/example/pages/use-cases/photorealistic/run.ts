import ThreeView, { Color } from "@navaramap/three";
import type {
  CloudsEffectDesc,
  RainDropEffectDesc,
  RainMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Vector2 } from "three";

import {
  LOCAL_DATASETS,
  TERRAIN_DATASETS,
  TILE_DATASETS,
  TILES_3D_DATASETS,
} from "../../../helpers/constants";

import { FLOOD_STEPS } from "./data";
import { addTimeSlider } from "./slider";

export type CustomDescriptions = DefaultDescriptions;

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const run = async (view: ThreeView<CustomDescriptions>) => {
  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);
  await view.init();

  defaultPlugin.addDefaultPhotorealScene();
  view.toneMappingExposure = 10;
  view.atmosphere.date = new Date("2024-10-21T01:00:00Z");

  view.setCamera({
    lng: 139.5988,
    lat: 35.8495,
    height: 600,
    heading: 0,
    pitch: -16,
    roll: 0,
  });

  // Re:Earth Buildings are modeled on Re:Earth Terrain, so their bases meet
  // this terrain without a height offset.
  const terrain = view.addSource({
    type: "quantized-mesh",
    url: TERRAIN_DATASETS.reearthQuantizedMesh.url,
    maxZoom: 18,
    requestVertexNormals: true,
    requestWaterMask: true,
  });
  view.addLayer({
    type: "terrain",
    source: terrain,
    terrain: { castShadow: true, receiveShadow: true },
  });

  const imagery = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.gsiSeamlessphoto.url,
    minZoom: 2,
    maxZoom: 18,
  });
  view.addLayer({ type: "raster", source: imagery });

  const buildings = view.addSource({
    type: "3d-tiles",
    url: TILES_3D_DATASETS.reearthBuildings.url,
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

  // Each MVT feature is one simulation cell carrying its water-surface height
  // per step (`t0`…`tN`), so switching steps only re-evaluates the features.
  const flood = view.addSource({
    type: "vector-tile",
    url: LOCAL_DATASETS.saitamaFloodBp002.url,
    maxZoom: 14,
  });
  const floodLayer = view.addLayer({
    type: "vector",
    source: flood,
    polygon: {
      color: new Color().setStyle("#5a3f1c"),
      // Heights come from the evaluator, so the polygons must not drape.
      clampToGround: false,
      water: true,
      applyWaterNormal: true,
      reflectivity: 0.3,
      waterScaleNormal: 0.3,
      specular: true,
      receiveShadow: true,
      // Each cell is a slab (see the evaluator); shading its sides like the
      // surface hides the steps between neighboring cells' levels.
      shadeSidesAsSurface: true,
      transparent: true,
      opacity: 0.85,
      // Blend only the nearest face, not every overlapping slab side.
      depthPrePass: true,
    },
  });

  // Start a day after the levee breach, when the water is already spreading.
  let step = 24;
  floodLayer.on("featureUpdated", ({ evaluator }) => {
    const key = `t${step}`;
    evaluator.evaluate(
      ({ properties }) => {
        const height = properties?.[key];
        // A 2 m slab up to the water level: its sides fill the steps between
        // neighboring cells. Extrude upward (`extrudedHeight` above
        // `height`), since the cap at `extrudedHeight` faces up.
        return typeof height === "number"
          ? { show: true, height: height - 2, extrudedHeight: height }
          : { show: false };
      },
      { filters: [key] },
    );
  });

  view.addEffect<CloudsEffectDesc>({
    clouds: {
      coverage: 0.6,
      localWeatherVelocity: new Vector2(0.005, 0.001),
      absorptionCoefficient: 5,
      haze: true,
      hazeDensityScale: 0.001,
      hazeExponent: 0.002,
      hazeAbsorptionCoefficient: 1.5,
    },
  });
  view.addMesh<RainMeshDesc>({
    rain: { particleCount: 5000, followCamera: true },
  });
  view.addEffect<RainDropEffectDesc>({
    rainDrop: {
      opacity: 0.5,
      dropDensity: 0.2,
      refractionStrength: 0.2,
      dropSizeFactor: 0.03,
      dropGridSize: 25,
    },
  });

  addTimeSlider({
    max: FLOOD_STEPS.length - 1,
    value: step,
    format: (i) => {
      const date = new Date(FLOOD_STEPS[i]);
      const hours = (date.getTime() - Date.parse(FLOOD_STEPS[0])) / 3_600_000;
      return `${TIME_FORMAT.format(date)} (${hours} h after the levee breach)`;
    },
    onChange: (i) => {
      step = i;
      floodLayer.forceUpdate();
    },
  });

  view.attribution?.add([
    TERRAIN_DATASETS.reearthQuantizedMesh,
    TILE_DATASETS.gsiSeamlessphoto,
    TILES_3D_DATASETS.reearthBuildings,
    LOCAL_DATASETS.saitamaFloodBp002,
  ]);
};
