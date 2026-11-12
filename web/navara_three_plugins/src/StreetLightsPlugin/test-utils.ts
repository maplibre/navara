import {
  isRoadClass,
  type StreetLightsBuildings,
  type StreetLightsRoads,
} from "./roads";

/** The `{z}/{x}/{y}` vector tiles the tests read. */
export const TEST_TEMPLATE = "https://t/{z}/{x}/{y}.pbf";

/** OpenMapTiles-like roads: `class` is the road class, `oneway` the direction. */
export const TEST_ROADS = {
  sourceType: "vector-tile",
  sourceUrl: TEST_TEMPLATE,
  sourceLayers: ["transportation"],
  filterFeatureProperties: ["class", "oneway"],
  evaluateFeature: ({ class: roadClass, oneway }) =>
    isRoadClass(roadClass)
      ? { roadClass, oneway: oneway === 1 || oneway === -1 ? oneway : 0 }
      : undefined,
} satisfies StreetLightsRoads;

/** OpenMapTiles-like buildings: roofs from 90 m up get a beacon. */
export const TEST_BUILDINGS = {
  sourceType: "vector-tile",
  sourceUrl: TEST_TEMPLATE,
  sourceLayers: ["building"],
  evaluateFeature: ({ render_height: height }) =>
    typeof height === "number" && height >= 90 ? height : undefined,
} satisfies StreetLightsBuildings;
