import ThreeView, { Color, type FeatureEvaluator } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";
import { Pane } from "tweakpane";

const view = new ThreeView<DefaultDescriptions>({
  backgroundColor: new Color().setStyle("#dfe3e8"),
});

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);

await view.init();

view.atmosphere.date = new Date("2026-06-21T15:00:00Z");
view.setCamera({
  lng: -80.2105,
  lat: 25.7605,
  height: 450,
  heading: 60,
  pitch: -30,
  roll: 0,
});

view.addLight({ ambient: { intensity: 0.6 } });
view.addLight({ sun: { intensity: 1.8 } });
view.addLayer({ type: "terrain", ellipsoid: {} });

const grayscale = await tilejson.addSource({
  type: "raster-tile",
  url: "https://papers.reearth.land/styles/grayscale/tilejson.json",
});
view.addLayer({ type: "raster", source: grayscale });

const buildings = await tilejson.addSource({
  type: "vector-tile",
  url: "https://papers.reearth.land/overture_buildings/tilejson.json",
});
const layer = view.addLayer({
  type: "vector",
  source: buildings,
  sourceLayers: ["building"],
  polygon: { height: 0, extrudedHeight: 0, clampToGround: false },
});

const params = { minArea: 0, largeArea: 1000 };
const small = new Color().setStyle("#9aa0a6");
const medium = new Color().setStyle("#0091ff");
const large = new Color().setStyle("#ff6b2c");

const styleByArea = ({ evaluator }: { evaluator: FeatureEvaluator }) => {
  evaluator.evaluate(
    ({ geometry, properties }) => {
      // `area` is in square meters, from the part of the footprint in this tile.
      const area = geometry?.type === "Polygon" ? geometry.area : 0;
      const height = properties?.["height"] as number | undefined;
      return {
        show: area >= params.minArea,
        color: area >= params.largeArea ? large : area >= 150 ? medium : small,
        extrudedHeight: height ?? 6,
      };
    },
    { filters: ["height"] },
  );
};
layer.on("featureCreated", styleByArea);
layer.on("featureUpdated", styleByArea);

const pane = new Pane({ title: "Footprint area" });
pane
  .addBinding(params, "minArea", { label: "hide below (m²)", min: 0, max: 500 })
  .on("change", () => layer.forceUpdate());
pane
  .addBinding(params, "largeArea", {
    label: "large from (m²)",
    min: 100,
    max: 10000,
  })
  .on("change", () => layer.forceUpdate());
