import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import {
  TERRAIN_DATASETS,
  TILE_DATASETS,
  VECTOR_DATASETS,
  FONT_DATASETS,
} from "../../../helpers/constants";
import { addDateControl } from "../../../helpers/control";

// Allowed feature codes (from GSI vector tile spec)
// Ref: https://maps.gsi.go.jp/help/pdf/vector/dataspec.pdf
const ALLOWED_FT_CODE = [
  51301, // Population 1M+
  51302, // Population 500K-1M
  51303, // Population <500K
  1401, // Prefectural capital
  1402, // City hall / Tokyo ward office
  1403, // Town/village office / Designated city ward office
  100, // Prefectural government
  3205, // City hall / Tokyo ward office
  3206, // Town/village office / Designated city ward office
  6321, // Broadleaf forest
  6322, // Coniferous forest
  6331, // Hot spring
];

const ALLOWED_ANNO_CTG = [
  110, // Municipality
  311, // Mountain name
  621, // Prefectural government
  661, // Shrine
];

// Per-feature declutter priority: bigger settlements win overlaps.
const DECLUTTER_PRIORITY: Record<number, number> = {
  51301: 3, // Population 1M+
  51302: 2, // Population 500K-1M
  51303: 1, // Population <500K
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

  // Camera position for Japan overview
  view.setCamera({
    lng: 139.0,
    lat: 36.0,
    height: 100000,
    heading: 0,
    pitch: -45,
    roll: 0,
  });

  // Base tiles layer
  const osmSource = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  });
  view.addLayer({
    type: "raster",
    source: osmSource,
  });
  const gsiTerrainDem = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
    maxZoom: 15,
  });
  view.addLayer({
    type: "terrain",
    source: gsiTerrainDem,
    terrain: {
      castShadow: true,
      receiveShadow: true,
    },
  });

  view.addLayer({
    type: "raster",
    source: gsiTerrainDem,
    hillshade: {},
  });

  // Track updated features to prevent duplicate evaluations
  let updatedFeatures = new Set<bigint>();

  const params = { size: 20, declutter: true };

  // MVT text layer: Symbols from GSI vector tiles
  const addMvtLayer = () => {
    updatedFeatures = new Set<bigint>();

    const gsiVectorSource = view.addSource({
      type: "vector-tile",
      url: VECTOR_DATASETS.gsiExperimentalVector.url,
      maxZoom: 16,
    });
    const layer = view.addLayer({
      type: "vector",
      source: gsiVectorSource,
      sourceLayers: ["symbol", "label"],
      text: {
        lang: "ja",
        font: FONT_DATASETS.LineSeedJP.url,
        color: new Color().setStyle("#ffffff"),
        sizeInMeters: false,
        clampToGround: true,
        size: params.size,
        anchor: "bottom",
        outlineColor: new Color().setStyle("#000000"),
        outlineWidth: 2,
        // Hide labels whose screen boxes overlap a higher-priority one
        declutter: params.declutter,
      },
    });

    // Feature evaluator: filter and style text labels
    layer.on("featureUpdated", ({ evaluator }) => {
      if (updatedFeatures.has(evaluator.id)) return;
      updatedFeatures.add(evaluator.id);

      const uniqueLabels = new Set<string>();

      evaluator.evaluate(
        ({ properties }) => {
          const text = (properties?.["knj"] ?? properties?.["name"]) as string;
          const ftCode = properties?.["ftCode"] as number;
          const annoCtg = properties?.["annoCtg"] as number;

          // Filter by feature code and annotation category
          if (
            !ALLOWED_FT_CODE.includes(ftCode) ||
            (annoCtg && !ALLOWED_ANNO_CTG.includes(annoCtg))
          ) {
            return { text: "", show: false };
          }

          // Deduplicate labels
          if (uniqueLabels.has(text)) {
            return { text: "", show: false };
          }

          uniqueLabels.add(text);

          return {
            text,
            show: !!text,
            declutterPriority: DECLUTTER_PRIORITY[ftCode] ?? 0,
          };
        },
        { filters: ["knj", "name", "ftCode", "annoCtg"] },
      );
    });

    return layer;
  };

  let layer: ReturnType<typeof addMvtLayer> | undefined = addMvtLayer();

  // Control panel
  const pane = new Pane({ title: "MVT Text Styling" });
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
    .addBinding(params, "size", { min: 10, max: 50, step: 1 })
    .on("change", ({ value }) => {
      layer?.update({ text: { size: value } });
    });

  pane.addBinding(params, "declutter").on("change", ({ value }) => {
    layer?.update({ text: { declutter: value } });
  });

  attribution?.add([
    TILE_DATASETS.openstreetmap,
    TERRAIN_DATASETS.gsi,
    VECTOR_DATASETS.gsiExperimentalVector,
  ]);
};

run();
