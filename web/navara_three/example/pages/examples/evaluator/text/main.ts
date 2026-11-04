import ThreeView, { Color, fetchFontFamilyFromCss } from "@navaramap/three";
import { TileJsonPlugin } from "@navaramap/three-plugins";

import { initializeExample } from "../../../../helpers/initialize";

import { oceans } from "./data";

const view = new ThreeView();

const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);

await view.init();

// Register a Google Font from its stylesheet; glyph files load lazily as
// labels first need them.
view.addFontFamily(
  await fetchFontFamilyFromCss(
    "Arsenal",
    "https://fonts.googleapis.com/css2?family=Arsenal:wght@700",
  ),
);

view.setCamera({
  lng: -25,
  lat: 8,
  height: 8_200_000,
  heading: 0,
  pitch: -90,
  roll: 0,
});

const basemap = await tilejson.addSource({
  type: "raster-tile",
  url: "https://papers.reearth.land/oceanbottom/tilejson.json",
});
view.addLayer({ type: "raster", source: basemap });

const source = view.addSource({ type: "geojson", data: oceans });
const layer = view.addLayer({
  type: "vector",
  source,
  text: {
    font: "Arsenal",
    color: new Color().setStyle("#ffffff"),
    size: 32,
    sizeInMeters: false,
    clampToGround: true,
    anchor: "bottom",
    outlineColor: new Color().setStyle("#000000"),
    outlineWidth: 4,
  },
});

layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => {
      const name = properties?.["name"] as string | undefined;
      return { text: name ?? "", show: !!name };
    },
    { filters: ["name"] },
  );
});

initializeExample(view);
