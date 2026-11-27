import ThreeView, { Color } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import type { FeatureCollection } from "geojson";
import { Pane } from "tweakpane";

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
 * - Nearest row (`"sdf": true` icons drawn in the per-feature `color`): a red
 *   dot, a blue dot three times larger with an edge as crisp, a black plus
 *   with sharp corners, and a plain (non-SDF) circle in the same layer.
 * - The two rows below it repeat those icons with a halo (`outline*`): a
 *   white 3 px ring, then a yellow 3 px ring blurred over 1 px. The ring is as
 *   wide around the large dot as around the small one, and the plain circle
 *   has none. In the white row the evaluator overrides the halo per feature:
 *   the large dot gets a red 4 px ring and the plus none (`outlineWidth: 0`).
 *
 * The panel changes the layers live:
 * - Top row `sprite`: the same sheet as a URL or as a list (icons keep their
 *   names), a sheet that fails to load (the row hides, with one warning), or
 *   none. Switching back and forth must not grow the atlas without end.
 * - Bottom row `icon`: the default for the feature whose evaluator returns
 *   `icon: null`; "(none)" hides it.
 * - Yellow halo row: `outline*` of the layer.
 * - Pixel ratio: 1 loads the 1x sheet, 2 the `@2x` one. Sizes and halo
 *   widths stay the same in CSS pixels.
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

const sdfIcons = [
  { icon: "dot-sdf", color: "#e53935", size: 1 },
  { icon: "dot-sdf", color: "#1e63e9", size: 3 },
  { icon: "plus-sdf", color: "#000000", size: 1.5 },
  { icon: "circle", color: "#ffffff", size: 1 },
];
const sdfData: FeatureCollection = {
  type: "FeatureCollection",
  features: row(
    CENTER.lat - 0.0055,
    sdfIcons.map((s) => s.icon),
  ).map((feature, i) => ({
    ...feature,
    properties: { ...sdfIcons[i] },
  })),
};
const addSdfRow = (
  lat: number,
  outline: {
    outlineColor?: Color;
    outlineWidth?: number;
    outlineBlur?: number;
  },
  featureOutlines: Record<
    string,
    { outlineColor?: Color; outlineWidth?: number }
  > = {},
) => {
  const data: FeatureCollection = {
    ...sdfData,
    features: sdfData.features.map((feature) => ({
      ...feature,
      geometry: {
        type: "Point",
        coordinates: [(feature.geometry as GeoJSON.Point).coordinates[0], lat],
      },
    })),
  };
  const layer = view.addLayer({
    type: "vector",
    source: view.addSource({ type: "geojson", data }),
    billboard: {
      sprite: SPRITE,
      sizeInMeters: false,
      sizeRelativeToImage: true,
      anchor: "bottom",
      clampToGround: true,
      declutter: false,
      // Blended, so SDF edges and the halo's blur fade instead of being cut
      // at `alphaTest`.
      transparent: true,
      ...outline,
    },
  });
  layer.on("featureCreated", ({ evaluator }) => {
    evaluator.evaluate(({ properties }) => ({
      icon: properties?.["icon"] as string,
      color: new Color().setStyle(properties?.["color"] as string),
      size: properties?.["size"] as number,
      ...featureOutlines[
        `${properties?.["icon"] as string}@${properties?.["size"] as number}`
      ],
    }));
  });
  return layer;
};

addSdfRow(CENTER.lat - 0.0055, {});
addSdfRow(
  CENTER.lat - 0.0072,
  { outlineColor: new Color().setHex(0xffffff), outlineWidth: 3 },
  {
    "dot-sdf@3": {
      outlineColor: new Color().setHex(0xe53935),
      outlineWidth: 4,
    },
    "plus-sdf@1.5": { outlineWidth: 0 },
  },
);
const haloLayer = addSdfRow(CENTER.lat - 0.0089, {
  outlineColor: new Color().setHex(0xffd400),
  outlineWidth: 3,
  outlineBlur: 1,
});

const SPRITES = {
  "shapes (URL)": SPRITE,
  "shapes (list)": [{ id: "default", url: SPRITE }],
  "missing sheet": new URL(withBase("/sprites/missing"), location.href).href,
  none: [],
};
const params = {
  sprite: "shapes (URL)",
  size: 1,
  icon: "shapes:arrow",
  outlineColor: "#ffd400",
  outlineOpacity: 1,
  outlineWidth: 3,
  outlineBlur: 1,
  pixelRatio: window.devicePixelRatio > 1 ? 2 : 1,
};

const pane = new Pane({ title: "Sprite" });

const topFolder = pane.addFolder({ title: "Top row" });
topFolder
  .addBinding(params, "sprite", {
    options: Object.fromEntries(Object.keys(SPRITES).map((k) => [k, k])),
  })
  .on("change", ({ value }) => {
    topLayer.update({
      billboard: { sprite: SPRITES[value as keyof typeof SPRITES] },
    });
  });
topFolder
  .addBinding(params, "size", { min: 0.25, max: 3, step: 0.25 })
  .on("change", ({ value }) => {
    topLayer.update({ billboard: { size: value } });
  });

pane
  .addFolder({ title: "Bottom row" })
  .addBinding(params, "icon", {
    label: "default icon",
    options: {
      arrow: "shapes:arrow",
      circle: "shapes:circle",
      square: "shapes:square",
      "(none)": "",
    },
  })
  .on("change", ({ value }) => {
    bottomLayer.update({ billboard: { icon: value } });
  });

const halo = pane.addFolder({ title: "Yellow halo row" });
halo.addBinding(params, "outlineColor").on("change", ({ value }) => {
  haloLayer.update({
    billboard: { outlineColor: new Color().setStyle(value) },
  });
});
halo
  .addBinding(params, "outlineOpacity", { min: 0, max: 1, step: 0.05 })
  .on("change", ({ value }) => {
    haloLayer.update({ billboard: { outlineOpacity: value } });
  });
halo
  .addBinding(params, "outlineWidth", { min: 0, max: 8, step: 0.5 })
  .on("change", ({ value }) => {
    haloLayer.update({ billboard: { outlineWidth: value } });
  });
halo
  .addBinding(params, "outlineBlur", { min: 0, max: 4, step: 0.25 })
  .on("change", ({ value }) => {
    haloLayer.update({ billboard: { outlineBlur: value } });
  });

pane
  .addBinding(params, "pixelRatio", {
    label: "pixel ratio",
    options: { "1": 1, "2": 2 },
  })
  .on("change", ({ value }) => {
    view.resize(undefined, undefined, value);
  });
