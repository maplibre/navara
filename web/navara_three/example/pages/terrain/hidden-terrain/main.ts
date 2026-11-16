import ThreeView, { Color } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import type { FeatureCollection } from "geojson";
import { Pane } from "tweakpane";

import {
  TERRAIN_DATASETS,
  TILES_3D_DATASETS,
} from "../../../helpers/constants";
import { addHidePaneKeyShortcut } from "../../../helpers/control";
import { GOOGLE_MAPS_API_KEY } from "../../../helpers/keys";

const places: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    { name: "Kengamine (summit)", lng: 138.72736, lat: 35.36056 },
    { name: "Summit crater", lng: 138.731, lat: 35.3628 },
    { name: "Mount Hoei", lng: 138.7447, lat: 35.3414 },
    { name: "Fuji Subaru Line 5th Station", lng: 138.7327, lat: 35.395 },
    { name: "Fujinomiya 5th Station", lng: 138.7352, lat: 35.3366 },
    { name: "Gotemba New 5th Station", lng: 138.7947, lat: 35.3355 },
    { name: "Subashiri 5th Station", lng: 138.7786, lat: 35.3662 },
  ].map(({ name, lng, lat }) => ({
    type: "Feature",
    properties: { name },
    geometry: { type: "Point", coordinates: [lng, lat] },
  })),
};

const view = new ThreeView<DefaultDescriptions>();

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);

const attribution = view.attribution;

await view.init();

defaultPlugin.addDefaultPhotorealScene();
view.toneMappingExposure = 5;
view.atmosphere.date = new Date("2026-07-16T02:00:00Z");

view.setCamera({
  lng: 138.7274,
  lat: 35.3606,
  height: 3000,
  distance: 13_000,
  heading: 20,
  pitch: -40,
  roll: 0,
});

const photorealSource = view.addSource({
  type: "3d-tiles",
  url: `${TILES_3D_DATASETS.googlePhotorealTiles.url}?key=${encodeURIComponent(
    GOOGLE_MAPS_API_KEY,
  )}`,
});
const photoreal = view.addLayer({
  type: "3d-tiles",
  source: photorealSource,
  model: { maxSse: 20 },
});

// The photoreal tiles are the visible surface, so the terrain mesh is hidden.
// Its heights still load and are what `clampToGround` reads. The source gives
// heights above the ellipsoid, the same datum as the photoreal tiles.
const terrainSource = view.addSource({
  type: "quantized-mesh",
  url: TERRAIN_DATASETS.reearthQuantizedMesh.url,
  maxZoom: 18,
});
const terrain = view.addLayer({
  type: "terrain",
  source: terrainSource,
  terrain: { show: false },
});

const placesSource = view.addSource({ type: "geojson", data: places });
const points = view.addLayer({
  type: "vector",
  source: placesSource,
  point: {
    color: new Color().setStyle("#ff4d2e"),
    size: 24,
    sizeInMeters: false,
    clampToGround: true,
  },
});

attribution?.add([
  { ...TILES_3D_DATASETS.googlePhotorealTiles, creditLayerId: photoreal.id },
  TERRAIN_DATASETS.reearthQuantizedMesh,
]);

const params = { terrainShow: false, clampToGround: true };

const pane = new Pane({ title: "Hidden terrain" });
pane
  .addBinding(params, "terrainShow", { label: "terrain" })
  .on("change", ({ value }) => {
    terrain.update({ terrain: { show: value } });
  });
pane
  .addBinding(params, "clampToGround", { label: "clamp" })
  .on("change", ({ value }) => {
    points.update({ point: { clampToGround: value } });
  });
addHidePaneKeyShortcut(pane);
