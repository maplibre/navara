/**
 * Debug page for MapLibre style expressions that read a feature property
 * under a computed name.
 *
 * Each square's fill color is `["get", ["concat", "color_", ["get", "kind"]]]`:
 * the property it reads is named by another property. The squares must come
 * out green (park), blue (water) and orange (road); black squares and
 * `CouldNotParse color null` errors in the console mean the expression did
 * not see the property.
 *
 * The squares are synthetic data, so the page credits no dataset.
 */
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";
import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const square = (lng: number, lat: number, properties: object) => ({
  type: "Feature" as const,
  properties,
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [lng, lat],
        [lng + 0.01, lat],
        [lng + 0.01, lat + 0.01],
        [lng, lat + 0.01],
        [lng, lat],
      ],
    ],
  },
});

const view = new ThreeView<DefaultDescriptions>({});
view.addPlugin(new DefaultPlugin());
view.addPlugin(
  new MapLibreStylePlugin({
    version: 8,
    center: [139.765, 35.685],
    zoom: 13,
    sources: {
      squares: {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            square(139.745, 35.68, { kind: "park", color_park: "#2e9e44" }),
            square(139.76, 35.68, { kind: "water", color_water: "#1f6fd1" }),
            square(139.775, 35.68, { kind: "road", color_road: "#e0a030" }),
          ],
        },
      },
    },
    layers: [
      {
        id: "squares",
        type: "fill",
        source: "squares",
        paint: {
          "fill-color": [
            "to-color",
            ["get", ["concat", "color_", ["get", "kind"]]],
          ],
        },
      },
    ],
  }),
);

await view.init();

view.addLayer({ type: "terrain", ellipsoid: {} });
