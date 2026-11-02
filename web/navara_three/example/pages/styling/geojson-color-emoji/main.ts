import ThreeView, { Color, fetchFontFamilyFromCss } from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { withBase } from "../../../helpers/base";
import { GEOJSON_DATASETS, TILE_DATASETS } from "../../../helpers/constants";
import { addDateControl } from "../../../helpers/control";

const FAMILY_NAME = "CityWithEmoji";

// Two @font-face stylesheets combined into one family, in priority order:
// the self-hosted multi-script city faces, then the sliced COLRv1 Noto
// Color Emoji subsets straight from the @infolektuell/noto-color-emoji
// package's own stylesheet on jsDelivr.
const FONT_CSS_URLS = [
  withBase("fonts/woff2/world-cities.css"),
  "https://cdn.jsdelivr.net/npm/@infolektuell/noto-color-emoji@0.2.0/index.css",
];

// Demo modes — each picks a different emoji per city to exercise different
// regions of the COLRv1 atlas.
type DemoMode = "flag" | "face" | "food" | "animal" | "mixed";

// prettier-ignore
const MIXED_PALETTE = ["🌟", "❤️", "🔥", "⚡", "💎", "🌈", "🚀", "✈️", "🎨", "🎵"];
const FACE_PALETTE = ["😀", "🥰", "😎", "🤩", "😴", "🥳", "🤔", "😇"];
const FOOD_PALETTE = ["🍕", "🍔", "🍣", "🍱", "🥑", "🍎", "🍇", "🌮"];
const ANIMAL_PALETTE = ["🐶", "🐱", "🦊", "🐻", "🐼", "🐨", "🦁", "🐯"];

const flagFor = (country: unknown): string => {
  if (typeof country !== "string" || country.length !== 2) return "🌍";
  const cc = country.toUpperCase();
  const a = cc.charCodeAt(0);
  const b = cc.charCodeAt(1);
  if (a < 65 || a > 90 || b < 65 || b > 90) return "🌍";
  return (
    String.fromCodePoint(0x1f1e6 + (a - 65)) +
    String.fromCodePoint(0x1f1e6 + (b - 65))
  );
};

/** Deterministic small hash so each city gets a stable emoji from a palette. */
const hashStr = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const pickEmoji = (mode: DemoMode, name: string, country: unknown): string => {
  if (mode === "flag") return flagFor(country);
  const palette =
    mode === "face"
      ? FACE_PALETTE
      : mode === "food"
        ? FOOD_PALETTE
        : mode === "animal"
          ? ANIMAL_PALETTE
          : MIXED_PALETTE;
  return palette[hashStr(name) % palette.length];
};

const run = async () => {
  const view = new ThreeView({ debug: true });

  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const attribution = view.attribution;

  await view.init();

  defaultPlugin.addDefaultPhotorealScene();

  // Each emoji subset is its own face declaring the unicode-range it
  // covers; the FontManager loads only the subsets actually needed by the
  // text on screen. The worker detects COLRv1 on load and routes glyphs
  // through the color atlas.
  view.addFontFamily(await fetchFontFamilyFromCss(FAMILY_NAME, FONT_CSS_URLS));

  view.setCamera({
    lng: 30,
    lat: 20,
    height: 20_000_000,
    heading: 0,
    pitch: -90,
    roll: 0,
  });

  const osm = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  });
  view.addLayer({ type: "raster", source: osm });

  const params: {
    size: number;
    mode: DemoMode;
  } = {
    size: 18,
    mode: "flag",
  };

  let updatedFeatures = new Set<bigint>();

  const addCityLayer = () => {
    updatedFeatures = new Set<bigint>();

    const citiesSource = view.addSource({
      type: "geojson",
      url: GEOJSON_DATASETS.worldCities.url,
    });
    const layer = view.addLayer({
      type: "vector",
      source: citiesSource,
      text: {
        font: FAMILY_NAME,
        color: new Color().setStyle("#ffffff"),
        size: params.size,
        sizeInMeters: false,
        clampToGround: true,
        depthTest: true,
        anchor: "bottom",
        outlineColor: new Color().setStyle("#000000"),
        outlineWidth: 5,
        outlineOpacity: 0.5,
      },
    });

    layer.on("featureUpdated", ({ evaluator }) => {
      if (updatedFeatures.has(evaluator.id)) return;
      updatedFeatures.add(evaluator.id);

      evaluator.evaluate(
        ({ properties }) => {
          const name = properties?.["name"] as string | undefined;
          if (!name) return { show: false };
          const emoji = pickEmoji(params.mode, name, properties?.["country"]);
          return { text: `${emoji}${name}`, show: true };
        },
        { filters: ["name", "country"] },
      );
    });

    return layer;
  };

  let layer: ReturnType<typeof addCityLayer> | undefined = addCityLayer();

  const pane = new Pane({ title: "GeoJSON Color Emoji" });
  addDateControl(view, pane);

  pane
    .addBinding(params, "mode", {
      options: {
        Flag: "flag",
        Face: "face",
        Food: "food",
        Animal: "animal",
        Mixed: "mixed",
      },
    })
    .on("change", () => {
      if (!layer) return;
      view.deleteLayerById(layer.id);
      layer = addCityLayer();
    });

  const toggleBtn = pane.addButton({ title: "Remove Layer", label: "layer" });
  toggleBtn.on("click", () => {
    if (layer) {
      view.deleteLayerById(layer.id);
      layer = undefined;
      toggleBtn.title = "Add Layer";
    } else {
      layer = addCityLayer();
      toggleBtn.title = "Remove Layer";
    }
  });

  pane
    .addBinding(params, "size", { min: 10, max: 60, step: 1 })
    .on("change", ({ value }) => {
      layer?.update({ text: { size: value } });
    });

  attribution?.add([TILE_DATASETS.openstreetmap]);
};

run();
