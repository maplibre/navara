import ThreeView, { Color, fetchFontFamilyFromCss } from "@navaramap/three";
import { TileJsonPlugin } from "@navaramap/three-plugins";

import { initializeExample } from "../../../../helpers/initialize";

const EVEREST = { lng: 86.925, lat: 27.9881 };

const view = new ThreeView();

const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);

await view.init();

view.addFontFamily(
  await fetchFontFamilyFromCss(
    "Arsenal",
    "https://fonts.googleapis.com/css2?family=Arsenal:wght@700",
  ),
);

view.setCamera({
  lng: EVEREST.lng,
  lat: EVEREST.lat,
  distance: 300,
  heading: 0,
  roll: 0,
});

const basemap = await tilejson.addSource({
  type: "raster-tile",
  url: "https://papers.reearth.land/styles/papers-light/tilejson.json",
});
view.addLayer({ type: "raster", source: basemap });

const source = view.addSource({
  type: "geojson",
  data: {
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [EVEREST.lng, EVEREST.lat] },
  },
});
view.addLayer({
  type: "vector",
  source,
  text: {
    text: "Mount Everest",
    font: "Arsenal",
    color: new Color().setStyle("#ffffff"),
    size: 110,
    sizeInMeters: false,
    clampToGround: true,
    anchor: "bottom",
    outlineColor: new Color().setStyle("#000000"),
    outlineWidth: 4,
  },
});

initializeExample(view);
