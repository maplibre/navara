import ThreeView, { Color, fetchFontFamilyFromCss } from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { withBase } from "../../../helpers/base";
import { GEOJSON_DATASETS, TILE_DATASETS } from "../../../helpers/constants";
import { addDateControl } from "../../../helpers/control";

// Self-hosted multi-script faces (Roboto + Noto Sans script fonts + sliced
// Noto Sans JP/SC/KR subsets), declared as @font-face rules with
// unicode-range. Only the CSS is fetched up front; each face file is
// downloaded lazily when a label first needs one of its codepoints.
const WORLD_FONT_CSS_URL = withBase("fonts/woff2/world-cities.css");

const run = async () => {
  const view = new ThreeView({
    debug: true,
  });

  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const attribution = view.attribution;

  await view.init();

  defaultPlugin.addDefaultPhotorealScene();

  // Register the multi-script font family from its @font-face stylesheet
  view.addFontFamily(
    await fetchFontFamilyFromCss("WorldCities", WORLD_FONT_CSS_URL),
  );

  // Global view: show all cities
  view.setCamera({
    lng: 30,
    lat: 20,
    height: 20_000_000,
    heading: 0,
    pitch: -90,
    roll: 0,
  });

  // Base tiles
  const osm = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  });
  view.addLayer({ type: "raster", source: osm });

  // Track updated features to prevent duplicate evaluations
  let updatedFeatures = new Set<bigint>();

  const params = {
    size: 15,
    // Wrap width in ems (multiples of size); 0 disables wrapping
    maxWidth: 0,
    lineHeight: 1.0,
    // Extra space between characters in ems; ignored for Arabic-script names
    letterSpacing: 0,
    textAlign: "center" as "left" | "center" | "right",
  };

  // GeoJSON text layer with font faces: city names in native scripts
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
        font: "WorldCities", // Uses the registered font family name
        color: new Color().setStyle("#ffffff"),
        size: params.size,
        sizeInMeters: false,
        clampToGround: true,
        depthTest: true,
        anchor: "bottom",
        outlineColor: new Color().setStyle("#000000"),
        outlineWidth: 5,
        outlineOpacity: 0.5,
        maxWidth: params.maxWidth,
        lineHeight: params.lineHeight,
        letterSpacing: params.letterSpacing,
        textAlign: params.textAlign,
      },
    });

    layer.on("featureUpdated", ({ evaluator }) => {
      if (updatedFeatures.has(evaluator.id)) return;
      updatedFeatures.add(evaluator.id);

      evaluator.evaluate(
        ({ properties }) => {
          const name = properties?.["name"] as string | undefined;
          return {
            text: name ?? "",
            show: !!name,
          };
        },
        { filters: ["name"] },
      );
    });

    return layer;
  };

  let layer: ReturnType<typeof addCityLayer> | undefined = addCityLayer();

  // Control panel
  const pane = new Pane({ title: "GeoJSON Font Faces" });
  addDateControl(view, pane);

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

  pane
    .addBinding(params, "maxWidth", { min: 0, max: 20, step: 0.5 })
    .on("change", ({ value }) => {
      layer?.update({ text: { maxWidth: value } });
    });

  pane
    .addBinding(params, "lineHeight", { min: 0.5, max: 3, step: 0.1 })
    .on("change", ({ value }) => {
      layer?.update({ text: { lineHeight: value } });
    });

  pane
    .addBinding(params, "letterSpacing", { min: -0.2, max: 1, step: 0.05 })
    .on("change", ({ value }) => {
      layer?.update({ text: { letterSpacing: value } });
    });

  pane
    .addBinding(params, "textAlign", {
      options: { Left: "left", Center: "center", Right: "right" },
    })
    .on("change", ({ value }) => {
      layer?.update({ text: { textAlign: value } });
    });

  attribution?.add([TILE_DATASETS.openstreetmap]);
};

run();
