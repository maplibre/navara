import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import { ToneMappingMode } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { FLOOD_RANK_COLOR_MAP } from "../../../helpers/colors";
import {
  LOCAL_DATASETS,
  TERRAIN_DATASETS,
  TILE_DATASETS,
} from "../../../helpers/constants";
import { addDateControl } from "../../../helpers/control";

type CustomDescriptions = DefaultDescriptions;

const run = async () => {
  const view = new ThreeView<CustomDescriptions>({
    debug: true,
  });
  view.addPlugin(new DefaultPlugin());

  const attribution = view.attribution;

  await view.init();

  view.addLight({
    sun: {},
  });

  view.addEffect({
    toneMapping: {
      mode: ToneMappingMode.NEUTRAL,
    },
  });

  const bloomEffect = view.addEffect({
    selectiveBloom: {
      strength: 1.0,
      radius: 0.5,
      threshold: 0.0,
    },
  });

  view.toneMappingExposure = 5;

  view.setCamera({
    lng: 139.841,
    lat: 35.5718,
    height: 9500,
    heading: -70,
    pitch: -41,
    roll: 0,
  });

  // Base layers
  const terrainDem = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
    maxZoom: 15,
  });
  view.addLayer({
    type: "terrain",
    source: terrainDem,
  });
  view.addLayer({
    type: "raster",
    source: terrainDem,
    hillshade: {},
  });

  const seamlessphoto = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.gsiSeamlessphoto.url,
    maxZoom: 18,
  });
  view.addLayer({
    type: "raster",
    source: seamlessphoto,
  });

  // Track updated features to prevent duplicate evaluations
  let updatedFeatures = new Set<bigint>();

  const addGeoJsonLayer = () => {
    updatedFeatures = new Set<bigint>();

    const floodSource = view.addSource({
      type: "geojson",
      url: LOCAL_DATASETS.tokyoFlood.url,
    });
    const layer = view.addLayer({
      type: "vector",
      source: floodSource,
      polygon: {
        color: new Color().setStyle("#ffffff"),
        emissiveColor: new Color().setStyle("#000000"),
        emissiveIntensity: 0.1,
        effectIds: [bloomEffect.id],
      },
    });

    // Feature evaluator: style polygons based on properties
    layer.on("featureUpdated", ({ evaluator }) => {
      if (updatedFeatures.has(evaluator.id)) return;
      updatedFeatures.add(evaluator.id);

      evaluator.evaluate(
        ({ properties }) => {
          const rank = Number(properties?.["A31a_205"] ?? 1);

          const [r, g, b] = FLOOD_RANK_COLOR_MAP[rank];

          return {
            color: new Color().setRGB(r / 255, g / 255, b / 255),
          };
        },
        { filters: ["A31a_205"] },
      );
    });

    return layer;
  };

  let layer: ReturnType<typeof addGeoJsonLayer> | undefined = addGeoJsonLayer();

  // Control panel
  const pane = new Pane({ title: "GeoJSON Polygon" });
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

  attribution?.add([
    TILE_DATASETS.gsiSeamlessphoto,
    TERRAIN_DATASETS.gsi,
    LOCAL_DATASETS.tokyoFlood,
  ]);
};

run();
