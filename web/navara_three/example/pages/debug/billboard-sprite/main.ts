import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import type { FeatureCollection } from "geojson";

import { withBase } from "../../../helpers/base";
import { TILE_DATASETS } from "../../../helpers/constants";

/**
 * Billboards drawn from a sprite sheet (`sprite` + `icon`).
 *
 * What to look for, left to right in each row:
 * - Top row (`sizeRelativeToImage`, size 1): a red circle, a green square and
 *   a yellow triangle pointing up, all the same size, then a blue rectangle
 *   twice as wide as tall. They stay that size on a high-DPI screen, where
 *   the `@2x` sheet is used.
 * - Bottom row (per-feature `icon`): circle, a gap where the icon name is not
 *   in the sprite, square, and the layer's default triangle where the
 *   evaluator returns `icon: null`.
 */

const CENTER = { lng: 139.7671, lat: 35.6812 };
const SPRITE = new URL(withBase("/sprites/shapes"), location.href).href;

const row = (lat: number, icons: (string | null | undefined)[]) =>
  icons.map((icon, i) => ({
    type: "Feature" as const,
    properties: { icon },
    geometry: {
      type: "Point" as const,
      coordinates: [CENTER.lng + (i - 1.5) * 0.004, lat],
    },
  }));

const view = new ThreeView<DefaultDescriptions>({ debug: true });
view.addPlugin(new DefaultPlugin());
await view.init();

view.addLayer({
  type: "raster",
  source: view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  }),
});

const top: FeatureCollection = {
  type: "FeatureCollection",
  features: row(CENTER.lat + 0.002, ["circle", "square", "arrow", "wide"]),
};
const topLayer = view.addLayer({
  type: "vector",
  source: view.addSource({ type: "geojson", data: top }),
  billboard: {
    sprite: SPRITE,
    size: 1,
    sizeInMeters: false,
    sizeRelativeToImage: true,
    anchor: "bottom",
    clampToGround: true,
  },
});
topLayer.on("featureCreated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => ({
    icon: properties?.["icon"] as string,
  }));
});

const bottom: FeatureCollection = {
  type: "FeatureCollection",
  features: row(CENTER.lat - 0.002, ["circle", "missing", "square", null]),
};
const bottomLayer = view.addLayer({
  type: "vector",
  source: view.addSource({ type: "geojson", data: bottom }),
  billboard: {
    sprite: [{ id: "shapes", url: SPRITE }],
    icon: "shapes:arrow",
    size: 48,
    sizeInMeters: false,
    anchor: "bottom",
    clampToGround: true,
  },
});
bottomLayer.on("featureCreated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const icon = properties?.["icon"] as string | null;
    return { icon: icon === null ? null : `shapes:${icon}` };
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
