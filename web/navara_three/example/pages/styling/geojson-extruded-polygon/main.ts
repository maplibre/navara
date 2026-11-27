import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import {
  LOCAL_DATASETS,
  TERRAIN_DATASETS,
  TILE_DATASETS,
} from "../../../helpers/constants";
import { addDateControl } from "../../../helpers/control";

const run = async () => {
  const view = new ThreeView<DefaultDescriptions>({
    debug: true,
    shadow: true,
  });

  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const attribution = view.attribution;

  await view.init();

  const defaultAtmospheres = defaultPlugin.addDefaultPhotorealScene();
  defaultAtmospheres.sun.update({
    sun: { intensity: 2, castShadow: true, shadowFar: 5000 },
  });

  view.addLight({
    ambient: {
      intensity: 0.5,
    },
  });

  view.setCamera({
    lng: 139.77,
    lat: 35.676,
    height: 300,
    heading: -45,
    pitch: -35,
    roll: 0,
  });

  // Base imagery as a raster-tile source.
  const baseImagery = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.gsiSeamlessphoto.url,
    maxZoom: 18,
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

  const params = { outlineShow: false };

  // GeoJSON extruded polygon layer - using interior GeoJSON dataset
  const addGeoJsonLayer = () => {
    updatedFeatures = new Set<bigint>();

    const geojsonSource = view.addSource({
      type: "geojson",
      url: LOCAL_DATASETS.interiorGeoJSON.url,
    });
    const layer = view.addLayer({
      type: "vector",
      source: geojsonSource,
      polygon: {
        color: new Color().setStyle("#ffffff"),
        height: 5,
        extrudedHeight: 0,
        clampToGround: false,
        castShadow: true,
        receiveShadow: true,
        outline: true,
        outlineShow: params.outlineShow,
        outlineWidth: 2,
        outlineColor: new Color().setHex(0xff00ff),
      },
    });

    // Feature evaluator: style polygons based on properties
    layer.on("featureUpdated", ({ evaluator }) => {
      if (updatedFeatures.has(evaluator.featureSetId)) return;
      updatedFeatures.add(evaluator.featureSetId);

      evaluator.evaluate(
        ({ properties }) => {
          const height = (properties?.["height"] as number) ?? 0;
          const color = (properties?.["color"] as string) ?? "#ffffff";
          const extrudedHeight =
            (properties?.["extrudedHeight"] as number) ?? 0;

          return {
            height,
            extrudedHeight,
            color: new Color().setStyle(color),
          };
        },
        { filters: ["height", "color", "extrudedHeight"] },
      );
    });

    return layer;
  };

  let layer: ReturnType<typeof addGeoJsonLayer> | undefined = addGeoJsonLayer();

  // Control panel
  const pane = new Pane({ title: "GeoJSON Extruded Polygon" });
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

  pane.addBinding(params, "outlineShow").on("change", ({ value }) => {
    layer?.update({ polygon: { outlineShow: value } });
  });

  // interiorGeoJSON is local sample data with no attribution, so it is omitted.
  attribution?.add([TILE_DATASETS.gsiSeamlessphoto, TERRAIN_DATASETS.gsi]);
};

run();
