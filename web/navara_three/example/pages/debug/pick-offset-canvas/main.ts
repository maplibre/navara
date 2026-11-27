import ThreeView, { Color, vector3ToGeodetic } from "@navaramap/three";
import type { SphereMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

import { TERRAIN_DATASETS, TILE_DATASETS } from "../../../helpers/constants";

/**
 * `pickTerrainPosition` on a map that does not start at the page origin, like
 * an app with a side panel and a header. Clicking the terrain places a sphere
 * at the picked position and a red ring at the clicked point.
 *
 * What to look for: the sphere lands inside the ring. With canvas-relative
 * picking it lands about 300 px right of and 50 px below the click.
 */

const OFFSET = { left: 300, top: 50 };

document.body.style.background = "#2b2b2b";
const container = document.createElement("div");
container.style.cssText = `position: absolute; left: ${OFFSET.left}px; top: ${OFFSET.top}px; right: 0; bottom: 0;`;
document.body.appendChild(container);

const view = new ThreeView<DefaultDescriptions>({ container, debug: true });
view.addPlugin(new DefaultPlugin());
await view.init();

view.addLight({ ambient: { intensity: 1 } });
view.addLight({ sun: { intensity: 3 } });

view.setCamera({
  lng: 7.6586,
  lat: 45.9763,
  height: 3900,
  distance: 5000,
  heading: 215,
  pitch: -22,
  roll: 0,
});

const terrain = view.addSource({
  type: "quantized-mesh",
  url: TERRAIN_DATASETS.reearthQuantizedMesh.url,
  maxZoom: 18,
  requestVertexNormals: true,
});
view.addLayer({ type: "terrain", source: terrain });
view.addLayer({
  type: "raster",
  source: view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  }),
});

const ring = document.createElement("div");
ring.style.cssText =
  "position: fixed; width: 24px; height: 24px; margin: -14px 0 0 -14px;" +
  "border: 2px solid #ff3b30; border-radius: 50%; pointer-events: none;" +
  "display: none; z-index: 10;";
document.body.appendChild(ring);

view.on("click", (event) => {
  ring.style.left = `${event.clientX}px`;
  ring.style.top = `${event.clientY}px`;
  ring.style.display = "block";

  const picked = view.pickTerrainPosition(event.clientX, event.clientY);
  if (!picked) return;
  view.addMesh<SphereMeshDesc>({
    sphere: { radius: 120, color: new Color().setStyle("#0091ff") },
    geodetic: vector3ToGeodetic(picked),
  });
});

view.attribution?.add([
  TERRAIN_DATASETS.reearthQuantizedMesh,
  TILE_DATASETS.openstreetmap,
]);
