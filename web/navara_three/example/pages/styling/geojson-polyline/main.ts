import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
  type LineCap,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import {
  LOCAL_DATASETS,
  TERRAIN_DATASETS,
  TILE_DATASETS,
} from "../../../helpers/constants";
import { addDateControl } from "../../../helpers/control";

// Dash and gap lengths in line widths. A zero-length dash is a dot once the
// cap is round.
const DASH_ARRAYS: Record<string, number[]> = {
  solid: [],
  dashed: [2, 2],
  dotted: [0, 2],
  "dash-dot": [3, 2, 0, 2],
};

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

  const params = {
    width: 10,
    maxWidth: 1000000,
    dash: "dotted",
    cap: "round" as LineCap,
    clampToGround: true,
  };

  // GeoJSON polyline layer with feature evaluator
  const addGeoJsonLayer = () => {
    updatedFeatures = new Set<bigint>();

    const railwaysSource = view.addSource({
      type: "geojson",
      url: LOCAL_DATASETS.railways.url,
    });
    const layer = view.addLayer({
      type: "vector",
      source: railwaysSource,
      polyline: {
        show: true,
        color: new Color().setStyle("#ff0000"),
        width: params.width,
        maxWidth: params.maxWidth,
        dashArray: DASH_ARRAYS[params.dash],
        cap: params.cap,
        height: 1,
        clampToGround: params.clampToGround,
      },
    });

    // Feature evaluator: style polylines based on properties
    layer.on("featureUpdated", ({ evaluator }) => {
      if (updatedFeatures.has(evaluator.id)) return;
      updatedFeatures.add(evaluator.id);

      evaluator.evaluate(
        ({ properties }) => {
          const railwayClass = String(properties?.["N02_001"] ?? "");

          // Color by railway class (N02_001)
          const colorMap: Record<string, string> = {
            "11": "#2563eb", // JR Railway - blue
            "12": "#dc2626", // Private Railway - red
            "13": "#92400e", // Cable Railway - brown
            "14": "#9333ea", // Suspended Monorail - purple
            "15": "#0891b2", // Straddling Monorail - cyan
            "16": "#16a34a", // Guide Rail Railway - green
            "17": "#eab308", // Trackless Railway - yellow
            "21": "#ea580c", // Tramway - orange
            "22": "#ec4899", // Suspended Monorail (tramway) - pink
            "23": "#84cc16", // Straddling Monorail (tramway) - lime
            "24": "#065f46", // Guide Rail System - dark green
            "25": "#d946ef", // Maglev - magenta
          };

          return {
            color: new Color().setStyle(colorMap[railwayClass] ?? "#888888"),
          };
        },
        { filters: ["N02_001"] },
      );
    });

    return layer;
  };

  let layer: ReturnType<typeof addGeoJsonLayer> | undefined = addGeoJsonLayer();

  // Control panel
  const pane = new Pane({ title: "GeoJSON Polyline Styling" });
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

  pane
    .addBinding(params, "width", { min: 1, max: 20, step: 1 })
    .on("change", ({ value }) => {
      layer?.update({ polyline: { width: value } });
    });

  pane
    .addBinding(params, "maxWidth", { min: 1, step: 1 })
    .on("change", ({ value }) => {
      layer?.update({ polyline: { maxWidth: value } });
    });

  pane
    .addBinding(params, "dash", {
      options: {
        solid: "solid",
        dashed: "dashed",
        dotted: "dotted",
        "dash-dot": "dash-dot",
      },
    })
    .on("change", ({ value }) => {
      layer?.update({ polyline: { dashArray: DASH_ARRAYS[value] } });
    });

  pane
    .addBinding(params, "cap", {
      options: { butt: "butt", round: "round", square: "square" },
    })
    .on("change", ({ value }) => {
      layer?.update({ polyline: { cap: value } });
    });

  // Draped lines and lines in the 3D scene are built differently, so the
  // layer is re-created.
  pane.addBinding(params, "clampToGround").on("change", () => {
    if (!layer) return;
    view.deleteLayerById(layer.id);
    layer = addGeoJsonLayer();
  });

  attribution?.add([
    TILE_DATASETS.openstreetmap,
    TERRAIN_DATASETS.gsi,
    LOCAL_DATASETS.railways,
  ]);
};

run();
