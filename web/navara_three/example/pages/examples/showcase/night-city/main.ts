import ThreeView, { Color, type FeatureEvaluator } from "@navaramap/three";
import type {
  BuildingWindowsEffectDesc,
  SelectiveBloomEffectDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import {
  StreetLightsPlugin,
  TileJsonPlugin,
  type StreetTrafficDescriptions,
} from "@navaramap/three-plugins";

import { addSlider } from "../../../../helpers/button";
import {
  OPEN_FREE_MAP_TILEJSON,
  TILE_DATASETS,
} from "../../../../helpers/constants";
import { initializeExample } from "../../../../helpers/initialize";

type NightDescriptions = DefaultDescriptions | StreetTrafficDescriptions;

const DETAIL_MAX_ALTITUDE = 6000;
const STREET_TILE_RADIUS = 2;
const BLOOM_STRENGTH = 1.2;
const FAR_BLOOM_STRENGTH = 0.5;
const STARS_INTENSITY = 400;

// `useNormal` lets the sun light the map itself; the traffic renders every frame.
const view = new ThreeView<NightDescriptions>({
  useNormal: true,
  animation: true,
});

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);
const streets = new StreetLightsPlugin({
  radius: STREET_TILE_RADIUS,
  traffic: { speed: 1, size: 2.5 },
});
view.addPlugin(streets);

await view.init();

const START = { lng: 139.762, lat: 35.672 };
view.setCamera({ ...START, height: 350, heading: 35, pitch: -14, roll: 0 });

const scene = defaultPlugin.addDefaultPhotorealScene();
scene.stars.update({ stars: { pointSize: 2, intensity: STARS_INTENSITY } });
view.addLight({ ambient: { intensity: 0.08 } });
// `hour` is local solar time where the camera is, so it means the same over
// Tokyo and over New York.
let hour = 20;
let hourLng = START.lng;
const setHour = (lng: number) => {
  view.atmosphere.setSolarTime({ lng }, hour);
  hourLng = lng;
};
setHour(START.lng);

// Both run right after the MRT pass, the later one first: with the bloom
// added first, the windows are drawn before the bloom composite. Only the
// lamps and beacons bloom: the windows (a post pass) and the traffic
// (additive points) write no emissive for it to read.
const bloom = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: { strength: BLOOM_STRENGTH, radius: 0.75, threshold: 0.5 },
});
const windows = view.addEffect<BuildingWindowsEffectDesc>({
  buildingWindows: { litRatio: 0.55 },
});

const osm = view.addSource({
  type: "raster-tile",
  url: TILE_DATASETS.openstreetmap.url,
  maxZoom: 18,
});
view.addLayer({ type: "raster", source: osm });
view.attribution?.add([TILE_DATASETS.openstreetmap]);

// The TileJSON also names the tile URL template the streets stream from.
let tileTemplate = "";
tilejson.on("loaded", ({ tilejson: document }) => {
  tileTemplate = document.tiles[0];
});
const openfreemap = await tilejson.addSource({
  type: "vector-tile",
  url: OPEN_FREE_MAP_TILEJSON,
});

// Buildings without a height get 6–16 m, hashed per building.
const estimatedHeight = (batchId: number) =>
  6 + 10 * ((Math.imul(batchId, 2654435761) >>> 0) / 4294967296);

const buildings = view.addLayer({
  type: "vector",
  source: openfreemap,
  sourceLayers: ["building"],
  polygon: {
    color: new Color().setStyle("#d9d0c9"),
    clampToGround: false,
    // Seeds the per-feature attributes the evaluator fills in.
    height: 0,
    extrudedHeight: 0,
    effectIds: [windows.id],
  },
});
const extrude = ({ evaluator }: { evaluator: FeatureEvaluator }) =>
  evaluator.evaluate(({ properties, batchId }) => {
    // Outlines whose parts are drawn separately stay flat.
    if (properties?.hide_3d === true) return { show: false };
    const top = properties?.render_height;
    return {
      show: true,
      height: 0,
      extrudedHeight: typeof top === "number" ? top : estimatedHeight(batchId),
    };
  });
buildings.on("featureCreated", extrude);
buildings.on("featureUpdated", extrude);

streets.addRoads(openfreemap);
// Lamps, beacons and traffic stream in around the camera; the lamps and beacons bloom.
streets.start({ tileTemplate, effectIds: [bloom.id] });

// Lights come on through civil twilight: fully on with the sun 6° below the
// horizon, off once it is 3° above.
const LIGHTS_ON_BELOW = Math.sin((-6 * Math.PI) / 180);
const LIGHTS_OFF_ABOVE = Math.sin((3 * Math.PI) / 180);
const currentDarkness = () => {
  const sun = view.atmosphere.sunDirection;
  const { x, y, z } = view.camera.positionECEF;
  const sinElevation =
    (sun.x * x + sun.y * y + sun.z * z) / Math.hypot(x, y, z);
  const t =
    (sinElevation - LIGHTS_ON_BELOW) / (LIGHTS_OFF_ABOVE - LIGHTS_ON_BELOW);
  return 1 - Math.min(1, Math.max(0, t));
};

let lod: "street" | "aerial" = "street";
let darkness = 1;

// postUpdate only fires on state changes, so the sun's clock triggers it too.
const refresh = () => {
  const { lng, lat, height } = view.camera.positionGeographic;
  // Keeps the slider's solar hour as the camera crosses longitudes.
  if (Math.abs(lng - hourLng) > 0.5) setHour(lng);
  const nextLod = height < DETAIL_MAX_ALTITUDE ? "street" : "aerial";
  if (nextLod === "street") streets.follow(lng, lat);

  const nextDarkness = currentDarkness();
  if (nextLod === lod && Math.abs(nextDarkness - darkness) < 0.01) return;
  if (nextLod !== lod) streets.setVisible(nextLod === "street");
  lod = nextLod;
  darkness = nextDarkness;

  windows.update({ buildingWindows: { intensity: darkness } });
  scene.stars.update({ stars: { intensity: STARS_INTENSITY * darkness } });
  bloom.update({
    selectiveBloom: {
      strength:
        (lod === "street" ? BLOOM_STRENGTH : FAR_BLOOM_STRENGTH) *
        (0.3 + 0.7 * darkness),
    },
  });
  streets.setLightsOn(darkness > 0.02);
};
view.on("postUpdate", refresh);
view.atmosphere.on("sunChanged", refresh);

addSlider("Hour", { min: 0, max: 24, value: hour, step: 0.25 }, (value) => {
  hour = value;
  setHour(hourLng);
});
addSlider(
  "Lit windows",
  { min: 0, max: 1, value: 0.55, step: 0.01 },
  (litRatio) => windows.update({ buildingWindows: { litRatio } }),
);
addSlider("Traffic speed", { min: 0, max: 4, value: 1, step: 0.05 }, (speed) =>
  streets.update({ traffic: { speed } }),
);

initializeExample(view);
