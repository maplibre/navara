import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import type { FeatureCollection } from "geojson";

import { TILE_DATASETS } from "../../../helpers/constants";

/**
 * Billboard layer with no material-level `url`: every image comes from the
 * FeatureEvaluator. Features the evaluator gives no image to stay invisible.
 *
 * What to look for:
 * - Blue and orange pins appear even though `billboard` carries no `url`.
 * - The two features without an `icon` property draw nothing at all — not a
 *   stray solid quad sampling the corner of whichever image packed first.
 */

const CENTER = { lng: 139.7671, lat: 35.6812 };

/** Inline pin, sized explicitly so the atlas decode is deterministic. */
const pin = (color: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="80" viewBox="0 0 64 80">` +
      `<path d="M32 78 8 40a24 24 0 1 1 48 0z" fill="${color}"/>` +
      `<circle cx="32" cy="28" r="9" fill="#fff"/></svg>`,
  );

const PINS: Record<string, string> = {
  blue: pin("#0091ff"),
  orange: pin("#ff6b2c"),
};

// Two of the six features deliberately carry no `icon`: the evaluator returns
// `image: null` for them, which with no material `url` means "nothing to draw".
const ICONS = ["blue", "orange", undefined, "blue", undefined, "orange"];

const data: FeatureCollection = {
  type: "FeatureCollection",
  features: ICONS.map((icon, i) => ({
    type: "Feature",
    properties: { icon },
    geometry: {
      type: "Point",
      coordinates: [CENTER.lng + (i - 2.5) * 0.004, CENTER.lat],
    },
  })),
};

const view = new ThreeView<DefaultDescriptions>({ debug: true });
view.addPlugin(new DefaultPlugin());
await view.init();

// Base map only — billboards and raster tiles are unlit, so no lights needed.
view.addLayer({
  type: "raster",
  source: view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  }),
});

const layer = view.addLayer({
  type: "vector",
  source: view.addSource({ type: "geojson", data }),
  billboard: {
    size: 64,
    sizeInMeters: false,
    anchor: "bottom",
    clampToGround: true,
  },
});

layer.on("featureCreated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const icon = properties?.["icon"] as string | undefined;
    return { image: icon ? (PINS[icon] ?? null) : null };
  });
});

view.setCamera({
  lng: CENTER.lng,
  lat: CENTER.lat - 0.012,
  height: 1600,
  heading: 0,
  pitch: -55,
  roll: 0,
});

view.attribution?.add([TILE_DATASETS.openstreetmap]);
