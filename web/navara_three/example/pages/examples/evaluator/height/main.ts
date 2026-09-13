import ThreeView, { Color, type FeatureEvaluator } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";

import { initializeExample } from "../../../../helpers/initialize";

const view = new ThreeView<DefaultDescriptions>({
  backgroundColor: new Color().setStyle("#dfe3e8"),
});

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);

await view.init();

view.atmosphere.date = new Date("2026-06-21T07:30:00Z");

view.setCamera({
  lng: 2.2958,
  lat: 48.8776,
  height: 150,
  heading: 183,
  pitch: -12,
  roll: 0,
});

view.addLight({ ambient: { intensity: 0.6 } });
view.addLight({ sun: { intensity: 1.8 } });

view.addLayer({ type: "terrain", ellipsoid: {} });

const base = await tilejson.addSource({
  type: "vector-tile",
  url: "https://papers.reearth.land/overture_base/tilejson.json",
});
view.addLayer({
  type: "vector",
  source: base,
  sourceLayers: ["land"],
  polygon: { color: new Color().setStyle("#e9e7e2") },
});
view.addLayer({
  type: "vector",
  source: base,
  sourceLayers: ["water"],
  polygon: { color: new Color().setStyle("#a9c9e2") },
});

const transportation = await tilejson.addSource({
  type: "vector-tile",
  url: "https://papers.reearth.land/overture_transportation/tilejson.json",
});
view.addLayer({
  type: "vector",
  source: transportation,
  sourceLayers: ["segment"],
  polyline: {
    color: new Color().setStyle("#ffffff"),
    width: 2,
  },
});

const divisions = await tilejson.addSource({
  type: "vector-tile",
  url: "https://papers.reearth.land/overture_divisions/tilejson.json",
});
view.addLayer({
  type: "vector",
  source: divisions,
  sourceLayers: ["division_boundary"],
  polyline: {
    color: new Color().setStyle("#9aa0a6"),
    width: 1.5,
  },
});

const buildings = await tilejson.addSource({
  type: "vector-tile",
  url: "https://papers.reearth.land/overture_buildings/tilejson.json",
});
const buildingLayer = view.addLayer({
  type: "vector",
  source: buildings,
  sourceLayers: ["building"],
  polygon: {
    color: new Color().setStyle("#f4f5f7"),
    height: 0,
    extrudedHeight: 0,
    clampToGround: false,
  },
});

const extrudeByHeight = ({ evaluator }: { evaluator: FeatureEvaluator }) => {
  evaluator.evaluate(
    ({ properties }) => {
      const height = properties?.["height"] as number | undefined;
      const numFloors = properties?.["num_floors"] as number | undefined;
      return {
        extrudedHeight: height ?? (numFloors != null ? numFloors * 3.2 : 8),
      };
    },
    { filters: ["height", "num_floors"] },
  );
};
buildingLayer.on("featureCreated", extrudeByHeight);
buildingLayer.on("featureUpdated", extrudeByHeight);

initializeExample(view);
