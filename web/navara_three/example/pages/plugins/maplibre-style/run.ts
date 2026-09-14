import {
  MapLibreStylePlugin,
  fetchFontFamilyFromCssForMapLibreStyle,
} from "@navaramap/maplibre-style";
import ThreeView from "@navaramap/three";
import { type DefaultDescriptions } from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import {
  MVT_DATASETS,
  TERRAIN_DATASETS,
  TILE_DATASETS,
} from "../../../helpers/constants";
import { addCameraControl } from "../../../helpers/control";

export type CustomDescriptions = DefaultDescriptions;

/**
 * Simple MapLibre Style example.
 * This demonstrates the basic functionality of the MapLibreStylePlugin.
 */
export async function run() {
  const view = new ThreeView<CustomDescriptions>({});

  // Add the MapLibre Style plugin
  const maplibrePlugin = new MapLibreStylePlugin(
    "https://demotiles.maplibre.org/globe.json",
    {
      fontFamily: await fetchFontFamilyFromCssForMapLibreStyle(
        "Open Sans",
        "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap",
      ),
      // Overriding light and other properties should be supported in the future.
    },
  );
  view.addPlugin(maplibrePlugin);

  const attribution = view.attribution;

  // Initialize the view
  await view.init();

  // Add ellipsoid terrain as the base surface for vector features
  view.addLayer({ type: "terrain", ellipsoid: {} });

  // Add controls
  const pane = new Pane();
  addCameraControl(view, pane);

  attribution?.add([
    TILE_DATASETS.openstreetmap,
    TERRAIN_DATASETS.mapterhorn,
    MVT_DATASETS.plateauTokyoFirePrevention,
    MVT_DATASETS.plateauGifuTran,
    MVT_DATASETS.plateauWakayamaGen,
  ]);
}
