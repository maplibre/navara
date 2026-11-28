import ThreeView, { Color } from "@navaramap/three";
import { TileJsonPlugin } from "@navaramap/three-plugins";

import { LOCAL_DATASETS } from "../../../../helpers/constants";
import { initializeExample } from "../../../../helpers/initialize";

const view = new ThreeView({
  backgroundColor: new Color().setStyle("#0b0d12"),
});

const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);

await view.init();

view.globe.color = new Color().setStyle("#15181c");

view.setCamera({
  lng: 139.758,
  lat: 35.652,
  height: 5_000,
  heading: 15,
  pitch: -58,
  roll: 0,
});

const basemap = await tilejson.addSource({
  type: "raster-tile",
  url: "https://papers.reearth.land/styles/papers-dark/tilejson.json",
});
view.addLayer({ type: "raster", source: basemap });

const railways = view.addSource({
  type: "geojson",
  url: LOCAL_DATASETS.railways.url,
});

// The glow: a wide line whose edge fades out over `blur` pixels, inside its width.
view.addLayer({
  type: "vector",
  source: railways,
  polyline: {
    color: new Color().setStyle("#0091ff"),
    width: 18,
    blur: 10.8,
    opacity: 0.7,
    // Faded edges overlap: without depth writes, each glow blends over the
    // others instead of hiding them.
    depthWrite: false,
    clampToGround: false,
    height: 2,
    // The plain color: there are no lights in this scene.
    lit: false,
  },
});

// The core: a thin sharp line of a lighter tint, a little above the glow so
// that the glow never covers it.
view.addLayer({
  type: "vector",
  source: railways,
  polyline: {
    color: new Color().setStyle("#e3f3ff"),
    width: 2.5,
    clampToGround: false,
    height: 3,
    lit: false,
  },
});

view.attribution?.add([
  {
    attribution: LOCAL_DATASETS.railways.attribution,
    attributionUrl: LOCAL_DATASETS.railways.attributionUrl,
  },
]);

initializeExample(view);
