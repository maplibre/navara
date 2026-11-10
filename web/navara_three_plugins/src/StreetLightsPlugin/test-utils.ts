import { isRoadClass, type TileSchema } from "./roads";

/**
 * The schema the test tiles follow, OpenMapTiles-like: `class` is the road
 * class and `oneway` the direction; roofs from 90 m up get a beacon.
 */
export const TEST_SCHEMA: TileSchema = {
  roads: {
    sourceLayers: ["transportation"],
    filterFeatureProperties: ["class", "oneway"],
    evaluateFeature: ({ class: roadClass, oneway }) =>
      isRoadClass(roadClass)
        ? { roadClass, oneway: oneway === 1 || oneway === -1 ? oneway : 0 }
        : undefined,
  },
  buildings: {
    sourceLayers: ["building"],
    evaluateFeature: ({ render_height: height }) =>
      typeof height === "number" && height >= 90 ? height : undefined,
  },
};
