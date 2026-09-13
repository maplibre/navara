import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { withBase } from "../../../helpers/base";
import {
  LOCAL_DATASETS,
  TERRAIN_DATASETS,
  TILE_DATASETS,
} from "../../../helpers/constants";
import { addDateControl } from "../../../helpers/control";

const run = async () => {
  const view = new ThreeView({
    debug: true,
  });
  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const attribution = view.attribution;

  await view.init();

  defaultPlugin.addDefaultPhotorealScene();

  view.setCamera({
    lng: 138.733,
    lat: 35.23,
    height: 1500000,
    heading: -10,
    pitch: -78,
    roll: 0,
  });

  // Base tiles layer
  const osm = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  });
  view.addLayer({ type: "raster", source: osm });

  const gsiTerrain = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
    maxZoom: 15,
  });
  view.addLayer({
    type: "terrain",
    source: gsiTerrain,
    terrain: {
      castShadow: true,
      receiveShadow: true,
    },
  });

  view.addLayer({
    type: "raster",
    source: gsiTerrain,
    hillshade: {},
  });

  // Track updated features to prevent duplicate evaluations
  let updatedFeatures = new Set<bigint>();

  const params = { size: 10.0 };

  // GeoJSON billboard layer
  const addGeoJsonLayer = () => {
    updatedFeatures = new Set<bigint>();

    const railwaysSource = view.addSource({
      type: "geojson",
      url: LOCAL_DATASETS.railwaysTimeSeries.url,
    });
    const layer = view.addLayer({
      type: "vector",
      source: railwaysSource,
      billboard: {
        color: new Color().setStyle("#ffffff"),
        size: params.size,
        height: 0,
        sizeInMeters: false,
        clampToGround: true,
        depthTest: true,
        url: withBase("example.png"),
        transparent: true,
        center: { x: 0.0, y: -0.5 },
      },
    });

    // Feature evaluator: style billboards based on properties
    layer.on("featureUpdated", ({ evaluator }) => {
      if (updatedFeatures.has(evaluator.id)) return;
      updatedFeatures.add(evaluator.id);

      evaluator.evaluate(
        ({ properties }) => {
          const isStopped = (properties?.["N05_005e"] as string) === "9999";

          return {
            color: new Color().setHex(isStopped ? 0xff0000 : 0xffffff),
          };
        },
        { filters: ["N05_005e"] },
      );
    });

    return layer;
  };

  let layer: ReturnType<typeof addGeoJsonLayer> | undefined = addGeoJsonLayer();

  // Control panel
  const pane = new Pane({ title: "GeoJSON Billboard Styling" });
  addDateControl(view, pane);

  // Toggle button to add/remove layer
  const toggleBtn = pane.addButton({ title: "Remove Layer", label: "layer" });
  toggleBtn.on("click", () => {
    if (layer) {
      view.deleteLayerById(layer.id);
      layer = undefined;
      toggleBtn.title = "Add Layer";
    } else {
      layer = addGeoJsonLayer();
      toggleBtn.title = "Remove Layer";
    }
  });

  pane.addBinding(params, "size").on("change", ({ value }) => {
    layer?.update({ billboard: { size: value } });
  });

  attribution?.add([
    TILE_DATASETS.openstreetmap,
    TERRAIN_DATASETS.gsi,
    LOCAL_DATASETS.railwaysTimeSeries,
  ]);
};

run();
