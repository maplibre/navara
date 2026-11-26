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

view.atmosphere.date = new Date("2026-06-21T07:30:00Z");

view.setCamera({
  lng: 2.2958,
  lat: 48.8745,
  height: 400,
  heading: 200,
  pitch: -35,
  roll: 0,
});

view.addLight({ ambient: { intensity: 0.6 } });
view.addLight({ sun: { intensity: 1.8 } });

view.addLayer({ type: "terrain", ellipsoid: {} });

const buildings = await tilejson.addSource({
  type: "vector-tile",
  url: "https://papers.reearth.land/overture_buildings/tilejson.json",
});

const params = {
  outlineShow: true,
  outlineColor: "#3a4a5c",
  outlineWidth: 1.5,
  heightScale: 1,
  baseHeight: 0,
};

// `outline: true` builds the outline geometry when tiles load, so
// `outlineShow` can be toggled later without reloading the layer.
const layer = view.addLayer({
  type: "vector",
  source: buildings,
  sourceLayers: ["building"],
  polygon: {
    color: new Color().setStyle("#f4f5f7"),
    height: 0,
    extrudedHeight: 0,
    clampToGround: false,
    outline: true,
    outlineShow: params.outlineShow,
    outlineColor: new Color().setStyle(params.outlineColor),
    outlineWidth: params.outlineWidth,
  },
});

const extrude = ({ evaluator }: { evaluator: FeatureEvaluator }) => {
  evaluator.evaluate(
    ({ properties }) => {
      const height = properties?.["height"] as number | undefined;
      const numFloors = properties?.["num_floors"] as number | undefined;
      const extrudedHeight =
        height ?? (numFloors != null ? numFloors * 3.2 : 8);
      return {
        height: params.baseHeight,
        extrudedHeight: extrudedHeight * params.heightScale,
      };
    },
    { filters: ["height", "num_floors"] },
  );
};
layer.on("featureCreated", extrude);
layer.on("featureUpdated", extrude);

const pane = new Pane({ title: "MVT Extruded Polygon Outline" });
pane.addBinding(params, "outlineShow").on("change", ({ value }) => {
  layer.update({ polygon: { outlineShow: value } });
});
pane.addBinding(params, "outlineColor").on("change", ({ value }) => {
  layer.update({ polygon: { outlineColor: new Color().setStyle(value) } });
});
pane
  .addBinding(params, "outlineWidth", { min: 0.5, max: 6, step: 0.5 })
  .on("change", ({ value }) => {
    layer.update({ polygon: { outlineWidth: value } });
  });
pane
  .addBinding(params, "heightScale", { min: 0.2, max: 3, step: 0.1 })
  .on("change", () => layer.forceUpdate());
pane
  .addBinding(params, "baseHeight", { min: 0, max: 50, step: 1 })
  .on("change", () => layer.forceUpdate());
