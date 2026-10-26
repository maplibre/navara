import type { FeatureCollection } from "geojson";

/**
 * A tight grid of named points, close enough that their labels and sprites
 * collide at the default camera, plus a winding road and a park outline for
 * along-line placement. Names mix lengths and scripts so wrapping, alignment
 * and `lang` have something to act on.
 */
const POINT_NAMES = [
  "Tokyo",
  "東京タワー",
  "Shinjuku Gyoen National Garden",
  "渋谷",
  "Ueno Park",
  "A",
  "Akihabara Electric Town",
  "銀座四丁目",
  "Roppongi Hills",
  "皇居外苑",
  "Odaiba Seaside Park",
  "上野動物園",
];

const COLUMNS = 4;
const ORIGIN = { lng: 139.745, lat: 35.69 };
const STEP = { lng: 0.006, lat: -0.005 };

export const data: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    ...POINT_NAMES.map((name, i) => ({
      type: "Feature" as const,
      properties: { name },
      geometry: {
        type: "Point" as const,
        coordinates: [
          ORIGIN.lng + (i % COLUMNS) * STEP.lng,
          ORIGIN.lat + Math.floor(i / COLUMNS) * STEP.lat,
        ],
      },
    })),
    {
      type: "Feature",
      properties: { name: "Meiji-dori Avenue" },
      geometry: {
        type: "LineString",
        coordinates: [
          [139.735, 35.66],
          [139.745, 35.666],
          [139.755, 35.662],
          [139.765, 35.668],
          [139.775, 35.664],
          [139.785, 35.67],
          [139.795, 35.666],
        ],
      },
    },
    {
      type: "Feature",
      properties: { name: "Imperial Palace East Garden" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [139.796, 35.692],
            [139.81, 35.692],
            [139.81, 35.68],
            [139.796, 35.68],
            [139.796, 35.692],
          ],
        ],
      },
    },
  ],
};
