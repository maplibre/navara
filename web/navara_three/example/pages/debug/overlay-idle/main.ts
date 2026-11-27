import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { OverlayPlugin, moveOverlayElement } from "@navaramap/three-plugins";
import { Pane } from "tweakpane";

import { TILE_DATASETS } from "../../../helpers/constants";

/**
 * OverlayPlugin on an idle map (`animation: false`): `setPositions` must
 * re-project and call `onUpdate` without anything else causing a render.
 *
 * What to look for (leave the camera still):
 * - "Move marker" moves the red marker to the next point at once.
 * - "Move from postRender" does the same from inside a `postRender` handler,
 *   i.e. during a frame. The marker still moves.
 * - "onUpdate calls" and "rendered frames" go up by about one per click and
 *   stay put otherwise: the map does not keep rendering.
 */

const CENTER = { lng: 139.7671, lat: 35.6812 };
const POINTS = [
  { lng: CENTER.lng - 0.004, lat: CENTER.lat + 0.002 },
  { lng: CENTER.lng + 0.004, lat: CENTER.lat + 0.002 },
  { lng: CENTER.lng + 0.004, lat: CENTER.lat - 0.002 },
  { lng: CENTER.lng - 0.004, lat: CENTER.lat - 0.002 },
];

const overlay = new OverlayPlugin();
const view = new ThreeView<DefaultDescriptions>({ debug: true });
view.addPlugin(new DefaultPlugin());
view.addPlugin(overlay);
await view.init();

view.addLayer({
  type: "raster",
  source: view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  }),
});

view.setCamera({
  lng: CENTER.lng,
  lat: CENTER.lat - 0.01,
  height: 1500,
  heading: 0,
  pitch: -60,
  roll: 0,
});

const container = document.createElement("div");
container.style.cssText =
  "position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 10;";
document.body.appendChild(container);

const marker = document.createElement("div");
marker.style.cssText =
  "position: absolute; left: -10px; top: -10px; width: 20px; height: 20px;" +
  "border-radius: 50%; background: #e5484d; border: 3px solid #fff;" +
  "box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);";
container.appendChild(marker);

const stats = { point: 0, onUpdateCalls: 0, renderedFrames: 0 };

overlay.onUpdate(({ projected }) => {
  stats.onUpdateCalls++;
  const pos = projected.get("marker");
  marker.style.display = pos ? "block" : "none";
  if (pos) moveOverlayElement(marker, pos.x, pos.y);
});
view.on("postRender", () => {
  stats.renderedFrames++;
});

const placeMarker = () => {
  const p = POINTS[stats.point];
  overlay.setPositions([{ id: "marker", lng: p.lng, lat: p.lat, alt: 0 }]);
};
const nextPoint = () => {
  stats.point = (stats.point + 1) % POINTS.length;
};
placeMarker();

const pane = new Pane({ title: "OverlayPlugin on an idle map" });
pane.addButton({ title: "Move marker" }).on("click", () => {
  nextPoint();
  placeMarker();
});
pane.addButton({ title: "Move from postRender" }).on("click", () => {
  const moveDuringFrame = () => {
    view.off("postRender", moveDuringFrame);
    nextPoint();
    placeMarker();
  };
  view.on("postRender", moveDuringFrame);
  // Render one frame so the handler runs, as app code hooked into the
  // render loop would.
  view.forceUpdate();
});
pane.addBinding(stats, "point", { readonly: true, interval: 200 });
pane.addBinding(stats, "onUpdateCalls", {
  readonly: true,
  label: "onUpdate calls",
  interval: 200,
});
pane.addBinding(stats, "renderedFrames", {
  readonly: true,
  label: "rendered frames",
  interval: 200,
});

view.attribution?.add([TILE_DATASETS.openstreetmap]);
