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
  isRoadClass,
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
// Roofs from here up get a beacon: high enough that skyscraper districts do
// not turn into a red mass.
const BEACON_HEIGHT = 90;

// `useNormal` lets the sun light the map itself; the traffic renders every frame.
const view = new ThreeView<NightDescriptions>({
  useNormal: true,
  animation: true,
});

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);
// OpenMapTiles marks the outline of a building drawn in parts; its parts carry the roof.
const drawnInParts = ({ hide_3d }: Record<string, unknown>) => hide_3d === true;

const streets = new StreetLightsPlugin({ tileJsonPlugin: tilejson });
view.addPlugin(streets);

await view.init();

const START = { lng: 139.762, lat: 35.672 };
view.setCamera({ ...START, height: 350, heading: 35, pitch: -14, roll: 0 });

const scene = defaultPlugin.addDefaultPhotorealScene();
scene.stars.update({ stars: { pointSize: 2, intensity: STARS_INTENSITY } });
view.addLight({ ambient: { intensity: 0.08 } });
let hour = 20;
let hourLng = START.lng;
const setHour = (lng: number) => {
  view.atmosphere.setSolarTime({ lng }, hour);
  hourLng = lng;
};
setHour(START.lng);

// Both insert right after the MRT pass, so the one added later runs first:
// adding the bloom first draws the windows before the bloom composite.
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
    if (drawnInParts(properties ?? {})) return { show: false };
    const top = properties?.render_height;
    return {
      show: true,
      height: 0,
      extrudedHeight: typeof top === "number" ? top : estimatedHeight(batchId),
    };
  });
buildings.on("featureCreated", extrude);
buildings.on("featureUpdated", extrude);

await streets.start({
  radius: STREET_TILE_RADIUS,
  traffic: { speed: 1, size: 2.5 },
  roads: {
    sourceType: "tilejson",
    sourceUrl: OPEN_FREE_MAP_TILEJSON,
    sourceLayers: ["transportation"],
    // Dark road surfaces; the plugin hides every class that carries no lights.
    polyline: { color: new Color().setStyle("#15171c"), clampToGround: true },
    filterFeatureProperties: ["class", "oneway"],
    evaluateFeature: ({ class: roadClass, oneway }) =>
      isRoadClass(roadClass)
        ? { roadClass, oneway: oneway === 1 || oneway === -1 ? oneway : 0 }
        : undefined,
  },
  buildings: {
    sourceType: "tilejson",
    sourceUrl: OPEN_FREE_MAP_TILEJSON,
    sourceLayers: ["building"],
    evaluateFeature: (properties) => {
      const height = properties.render_height;
      return typeof height === "number" &&
        height >= BEACON_HEIGHT &&
        !drawnInParts(properties)
        ? height
        : undefined;
    },
  },
  effectIds: [bloom.id],
});

// Lights come on through civil twilight: sun from 3° above to 6° below.
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
