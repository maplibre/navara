import ThreeView, { Color } from "@navaramap/three";
import { TileJsonPlugin } from "@navaramap/three-plugins";

import { initializeExample } from "../../../../helpers/initialize";

const ASSETS = import.meta.env.BASE_URL; // "/examples/" on navara.world

const EVEREST = { lng: 86.925, lat: 27.9881 };

const view = new ThreeView();

const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);

await view.init();

view.setCamera({
  lng: EVEREST.lng,
  lat: EVEREST.lat,
  distance: 7000,
  heading: 0,
  pitch: -55,
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
  billboard: {
    url: `${ASSETS}example.png`,
    color: new Color().setStyle("#ffffff"),
    size: 160,
    sizeInMeters: false,
    anchor: "bottom",
    transparent: true,
    clampToGround: true,
  },
});

initializeExample(view);
