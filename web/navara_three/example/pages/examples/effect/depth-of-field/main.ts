import ThreeView, { Color, type FeatureEvaluator } from "@navaramap/three";
import type { DepthOfFieldEffectDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";

import { addSlider } from "../../../../helpers/button";
import { initializeExample } from "../../../../helpers/initialize";
import { resolveOvertureDatasets } from "../../../../helpers/overture";

const METERS_PER_FLOOR = 3;
const DEFAULT_BUILDING_HEIGHT = 6;

const view = new ThreeView<DefaultDescriptions>();

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);

await view.init();

defaultPlugin.addDefaultPhotorealScene();
view.toneMappingExposure = 10;
view.atmosphere.date = new Date("2026-07-16T22:30:00Z");

view.setCamera({
  lng: -73.9862,
  lat: 40.7248,
  height: 66,
  heading: 349,
  pitch: -2.5,
  roll: 0,
});
view.camera.fov = 24;

let focusMeters = 420;
const dof = view.addEffect<DepthOfFieldEffectDesc>({
  depthOfField: {
    focusDistance: focusMeters,
    focalLength: 500,
    bokehScale: 9,
  },
});

const basemap = await tilejson.addSource({
  type: "raster-tile",
  url: "https://papers.reearth.land/styles/papers-light/tilejson.json",
});

view.addLayer({ type: "raster", source: basemap });

view.addLayer({ type: "terrain", ellipsoid: {} });

const overture = await resolveOvertureDatasets();
const buildings = view.addSource({
  type: "vector-tile",
  url: overture.buildings.url,
  maxZoom: 14,
});

const buildingLayer = view.addLayer({
  type: "vector",
  source: buildings,
  sourceLayers: ["building"],
  polygon: {
    color: new Color().setStyle("#ffffff"),
    extrudedHeight: 0,
    clampToGround: false,
  },
});

const extrudeByAttributes = ({ evaluator }: { evaluator: FeatureEvaluator }) =>
  evaluator.evaluate(
    ({ properties }) => {
      const height = properties?.["height"] as number | undefined;
      const numFloors = properties?.["num_floors"] as number | undefined;
      const extrudedHeight =
        height ??
        (numFloors != null
          ? numFloors * METERS_PER_FLOOR
          : DEFAULT_BUILDING_HEIGHT);
      return { extrudedHeight };
    },
    { filters: ["height", "num_floors"] },
  );
buildingLayer.on("featureCreated", extrudeByAttributes);
buildingLayer.on("featureUpdated", extrudeByAttributes);

addSlider(
  "Focus",
  { min: 100, max: 3000, value: focusMeters, step: 50, unit: "m" },
  (value) => {
    focusMeters = value;
    dof.update({ depthOfField: { focusDistance: focusMeters } });
  },
);

view.attribution?.add([overture.buildings]);

initializeExample(view);
