import ThreeView, { TERRARIUM_ELEVATION_DECODER } from "@navaramap/three";

import { TURBO_COLOR_MAP } from "../../../../helpers/colors";
import { initializeExample } from "../../../../helpers/initialize";

const view = new ThreeView();

await view.init();

view.setCamera({
  lng: 7.66,
  lat: 45.98,
  height: 800_000,
  heading: 0,
  pitch: -90,
  roll: 0,
});

const dem = view.addSource({
  type: "raster-dem",
  url: "https://terrain.reearth.land/terrarium/elevation/{z}/{x}/{y}.png",
  elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  tileSize: 512,
  maxZoom: 15,
});
view.addLayer({
  type: "raster",
  source: dem,
  elevationHeatmap: {
    colorMap: TURBO_COLOR_MAP.flatten(),
    maxHeight: 3200,
    minHeight: 0,
    logarithmic: true,
    logBoundary: 1000,
  },
});

view.attribution?.add([
  {
    attribution: "Re:Earth Terrain",
    attributionUrl: "https://terrain.reearth.land/",
  },
  {
    attribution: "© Mapterhorn",
    attributionUrl: "https://mapterhorn.com/attribution",
  },
]);

initializeExample(view);
