import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import {
  MVT_DATASETS,
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

  // Camera position for Wakayama
  view.setCamera({
    lng: 135.18,
    lat: 34.07,
    height: 15000,
    heading: 0,
    pitch: -45,
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

  const params = { size: 500 };

  // MVT point layer: Heliports in Wakayama
  const addMvtLayer = () => {
    updatedFeatures = new Set<bigint>();

    const heliportsSource = view.addSource({
      type: "vector-tile",
      url: MVT_DATASETS.plateauWakayamaGen.url,
      maxZoom: 16,
    });
    const layer = view.addLayer({
      type: "vector",
      source: heliportsSource,
      point: {
        size: params.size,
        sizeInMeters: true,
        clampToGround: true,
        color: new Color().setStyle("#ff0000"),
        anchor: "bottom",
      },
    });

    // Feature evaluator: style points based on properties
    layer.on("featureUpdated", ({ evaluator }) => {
      if (updatedFeatures.has(evaluator.id)) return;
      updatedFeatures.add(evaluator.id);

      evaluator.evaluate(
        ({ properties }) => {
          const type = properties?.["備考"] as string;

          // Color based on heliport type
          const color = (() => {
            // Athletic field (陸上競技場)
            if (type === "陸上競技場") {
              return 0x0000ff;
            }
            // Riverbed (河川敷)
            if (type?.endsWith("河川敷")) {
              return 0x00ff00;
            }
            return 0xff0000;
          })();

          return {
            color: new Color().setHex(color),
          };
        },
        { filters: ["備考"] },
      );
    });

    return layer;
  };

  let layer: ReturnType<typeof addMvtLayer> | undefined = addMvtLayer();

  // Control panel
  const pane = new Pane({ title: "MVT Point Styling" });
  addDateControl(view, pane);

  // Toggle button to add/remove layer
  const toggleBtn = pane.addButton({ title: "Remove Layer", label: "layer" });
  toggleBtn.on("click", () => {
    if (layer) {
      view.deleteLayerById(layer.id);
      layer = undefined;
      toggleBtn.title = "Add Layer";
    } else {
      layer = addMvtLayer();
      toggleBtn.title = "Remove Layer";
    }
  });

  pane.addBinding(params, "size").on("change", ({ value }) => {
    layer?.update({ point: { size: value } });
  });

  attribution?.add([
    TILE_DATASETS.openstreetmap,
    TERRAIN_DATASETS.gsi,
    MVT_DATASETS.plateauWakayamaGen,
  ]);
};

run();
