import ThreeView, { JAPAN_GSI_ELEVATION_DECODER } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { TERRAIN_DATASETS, TILE_DATASETS } from "../../../helpers/constants";

/**
 * `sampleTerrainMostDetailed` with many positions whose most detailed tiles
 * do not exist. The GSI DEM has data up to z14, and the source asks for z15,
 * so every z15 request 404s and positions in different z15 tiles fall back
 * to the same z14 tile, which is then read for all of them.
 *
 * What to look for: "status" reads `ok` and "sampled" is 30 / 30, with
 * heights in the readout. A failure shows the error message instead.
 */

const CENTER = { lng: 139.7671, lat: 35.6812 };
// Close enough to share a z14 tile, spread over several z15 tiles.
const POSITIONS = Array.from({ length: 30 }, (_, i) => ({
  lng: 139.76 + i * 0.0005,
  lat: 35.68 + i * 0.0005,
}));

const view = new ThreeView<DefaultDescriptions>({ debug: true });
view.addPlugin(new DefaultPlugin());
await view.init();

const dem = view.addSource({
  type: "raster-dem",
  url: TERRAIN_DATASETS.gsi.url,
  elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  minZoom: 5,
  // One level deeper than the data, so the deepest requests 404.
  maxZoom: 15,
});
view.addLayer({ type: "terrain", source: dem });
view.addLayer({
  type: "raster",
  source: view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  }),
});

view.setCamera({
  lng: CENTER.lng,
  lat: CENTER.lat - 0.012,
  height: 1600,
  heading: 0,
  pitch: -55,
  roll: 0,
});

const result = { status: "sampling…", sampled: "", heights: "" };

const sample = async () => {
  result.status = "sampling…";
  result.sampled = "";
  result.heights = "";
  try {
    const sampled = await view.sampleTerrainMostDetailed(dem, POSITIONS);
    const heights = sampled.map((p) => p.height);
    const defined = heights.filter((h) => h !== undefined);
    result.status = "ok";
    result.sampled = `${defined.length} / ${POSITIONS.length}`;
    result.heights = heights
      .map((h) => (h === undefined ? "–" : h.toFixed(1)))
      .join(", ");
  } catch (error) {
    result.status = `error: ${error instanceof Error ? error.message : String(error)}`;
  }
};

const pane = new Pane({ title: "sampleTerrainMostDetailed" });
pane.addButton({ title: "Sample 30 positions" }).on("click", () => {
  void sample();
});
pane.addBinding(result, "status", {
  readonly: true,
  multiline: true,
  rows: 3,
  interval: 200,
});
pane.addBinding(result, "sampled", { readonly: true, interval: 200 });
pane.addBinding(result, "heights", {
  readonly: true,
  multiline: true,
  rows: 6,
  interval: 200,
});

void sample();

view.attribution?.add([TERRAIN_DATASETS.gsi, TILE_DATASETS.openstreetmap]);
