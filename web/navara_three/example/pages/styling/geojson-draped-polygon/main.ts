import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { TERRAIN_DATASETS, TILE_DATASETS } from "../../../helpers/constants";
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
    lng: 138.753,
    lat: 35.2,
    height: 15000,
    heading: 0,
    pitch: -45,
    roll: 0,
  });

  // Base imagery as a raster-tile source.
  const baseImagery = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  });
  view.addLayer({ type: "raster", source: baseImagery });

  // GSI DEM as a raster-dem source, shared by the terrain and the hillshade.
  const dem = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
    maxZoom: 15,
  });
  view.addLayer({
    type: "terrain",
    source: dem,
    terrain: { castShadow: true, receiveShadow: true },
  });
  view.addLayer({
    type: "raster",
    source: dem,
    hillshade: {},
  });

  // Track updated features to prevent duplicate evaluations
  let updatedFeatures = new Set<bigint>();

  const params = { opacity: 0.7 };

  // GeoJSON draped polygon layer - same data as override-material
  const addGeoJsonLayer = () => {
    updatedFeatures = new Set<bigint>();

    const geojsonSource = view.addSource({
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { type: "polygon", No: 1 },
            geometry: {
              coordinates: [
                [
                  [138.69076314566468, 35.43223503721363],
                  [138.68002181948253, 35.33332769554936],
                  [138.83040038604383, 35.37455382402081],
                  [138.83545512777675, 35.42708660707885],
                  [138.69076314566468, 35.43223503721363],
                ],
              ],
              type: "Polygon",
            },
          },
          {
            type: "Feature",
            properties: { type: "polygon", No: 2 },
            geometry: {
              coordinates: [
                [
                  [138.83166407147775, 35.37249301745116],
                  [138.68002181948253, 35.330750363829665],
                  [138.66991233601522, 35.26164726716193],
                  [138.81776353171153, 35.263710900396646],
                  [138.83166407147775, 35.37249301745116],
                ],
              ],
              type: "Polygon",
            },
          },
        ],
      },
    });
    const layer = view.addLayer({
      type: "vector",
      source: geojsonSource,
      polygon: {
        color: new Color().setStyle("#00aaff"),
        height: 0,
        clampToGround: true,
        wireframe: false,
        opacity: params.opacity,
      },
    });

    // Feature evaluator: style polygons based on properties
    layer.on("featureUpdated", ({ evaluator }) => {
      if (updatedFeatures.has(evaluator.featureSetId)) return;
      updatedFeatures.add(evaluator.featureSetId);

      evaluator.evaluate(
        ({ properties }) => {
          const num = (properties?.["No"] as number) ?? 0;

          // Generate color based on feature number
          const idx = num % 6;
          const r = Math.abs(Math.sin(idx + 0));
          const g = Math.abs(Math.sin(idx + 1));
          const b = Math.abs(Math.sin(idx + 2));

          return {
            color: new Color().setRGB(r, g, b),
          };
        },
        { filters: ["No"] },
      );
    });

    return layer;
  };

  let layer: ReturnType<typeof addGeoJsonLayer> | undefined = addGeoJsonLayer();

  // Control panel
  const pane = new Pane({ title: "GeoJSON Draped Polygon" });
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

  attribution?.add([TILE_DATASETS.openstreetmap, TERRAIN_DATASETS.gsi]);
};

run();
