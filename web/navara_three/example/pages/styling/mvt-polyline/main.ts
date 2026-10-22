import ThreeView, {
  Color,
  TERRARIUM_ELEVATION_DECODER,
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

  // Camera position for Gifu
  view.setCamera({
    lng: 136.76,
    lat: 35.39,
    height: 3000,
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

  const mapterhornTerrain = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.mapterhorn.url,
    elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
    maxZoom: 15,
    minZoom: 5,
    tileSize: 512,
  });
  view.addLayer({
    type: "terrain",
    source: mapterhornTerrain,
    terrain: {
      castShadow: true,
      receiveShadow: true,
    },
  });

  view.addLayer({
    type: "raster",
    source: mapterhornTerrain,
    hillshade: {},
  });

  // Track updated features to prevent duplicate evaluations
  let updatedFeatures = new Set<bigint>();

  const params = { width: 5 };

  // MVT polyline layer: Roads in Gifu
  const addMvtLayer = () => {
    updatedFeatures = new Set<bigint>();

    const roadsSource = view.addSource({
      type: "vector-tile",
      url: MVT_DATASETS.plateauGifuTran.url,
      maxZoom: 16,
    });
    const layer = view.addLayer({
      type: "vector",
      source: roadsSource,
      polyline: {
        width: params.width,
        height: 1,
        clampToGround: true,
      },
    });

    // Feature evaluator: style roads based on tree presence
    layer.on("featureUpdated", ({ evaluator }) => {
      if (updatedFeatures.has(evaluator.id)) return;
      updatedFeatures.add(evaluator.id);

      evaluator.evaluate(
        ({ properties }) => {
          const rawAttributes = properties?.["attributes"];
          const attrs =
            typeof rawAttributes === "string" ? JSON.parse(rawAttributes) : {};
          const generics = attrs["gen:genericAttribute"] as unknown[];

          // Find tree presence info
          const treeInfo = generics?.find(
            (g) =>
              g &&
              typeof g === "object" &&
              "name" in g &&
              g.name === "樹木の有無",
          ) as { value: { value: string }[] } | undefined;

          const code = treeInfo?.value[0]?.value;

          // Color and dash pattern based on street tree presence: a solid
          // green line with street trees, a dashed gray one without.
          const hasStreetTrees = code === "1";

          return {
            color: new Color().setHex(hasStreetTrees ? 0x00ff00 : 0x777777),
            // Dash and gap lengths in line widths; an empty array is solid.
            dashArray: hasStreetTrees ? [] : [3, 1.5],
          };
        },
        { filters: ["attributes"] },
      );
    });

    return layer;
  };

  let layer: ReturnType<typeof addMvtLayer> | undefined = addMvtLayer();

  // Control panel
  const pane = new Pane({ title: "MVT Polyline Styling" });
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

  pane
    .addBinding(params, "width", { min: 1, max: 20, step: 1 })
    .on("change", ({ value }) => {
      layer?.update({ polyline: { width: value } });
    });

  attribution?.add([
    TILE_DATASETS.openstreetmap,
    TERRAIN_DATASETS.mapterhorn,
    MVT_DATASETS.plateauGifuTran,
  ]);
};

run();
