import ThreeView, {
  type FitBoundsBox,
  type FitBoundsPosition,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { OverlayPlugin, moveOverlayElement } from "@navaramap/three-plugins";
import { Pane } from "tweakpane";

import { TILE_DATASETS } from "../../../helpers/constants";

/**
 * `ThreeView.fitBounds`: frames a set of positions or a box in the padded
 * canvas.
 *
 * What to look for after a fit settles:
 * - Every red marker is inside the dashed padding rectangle.
 * - The markers touch the rectangle on one axis (two "margin" readouts are
 *   0 px) and are centered on the other (the other two are equal).
 * - Changing heading, pitch or padding and fitting again keeps both.
 * - `?initial=<set index>` fits that set right after `init()`, before the
 *   first frame (heading 0, pitch -90); the status reads "initial: true".
 *   Resizing the window during that flight still lands on a fit.
 *
 * The readout is the projected extent of the markers through the engine's
 * camera (OverlayPlugin), in CSS pixels.
 */

type FitSet = { name: string; target: FitBoundsBox | FitBoundsPosition[] };

/** Positions shown as markers: a set's own, or a box's edges. */
function markerPositions(target: FitSet["target"]): FitBoundsPosition[] {
  if (Array.isArray(target)) return target;
  const { west, south, north } = target;
  const east = target.east < west ? target.east + 360 : target.east;
  const positions: FitBoundsPosition[] = [];
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    positions.push(
      { lng: west + (east - west) * t, lat: south },
      { lng: east, lat: south + (north - south) * t },
      { lng: east - (east - west) * t, lat: north },
      { lng: west, lat: north - (north - south) * t },
    );
  }
  return positions.map((p) => ({
    ...p,
    lng: p.lng > 180 ? p.lng - 360 : p.lng,
  }));
}

const SETS: FitSet[] = [
  {
    name: "Tokyo: start + parks",
    target: [
      { lng: 139.7671, lat: 35.6812 },
      { lng: 139.756, lat: 35.6735 },
      { lng: 139.758, lat: 35.6852 },
      { lng: 139.7633, lat: 35.66 },
      { lng: 139.7745, lat: 35.6866, height: 150 },
    ],
  },
  {
    name: "Tama River",
    target: [
      { lng: 139.31, lat: 35.766 },
      { lng: 139.353, lat: 35.7 },
      { lng: 139.41, lat: 35.688 },
      { lng: 139.48, lat: 35.66 },
      { lng: 139.548, lat: 35.64 },
      { lng: 139.626, lat: 35.608 },
      { lng: 139.668, lat: 35.577 },
      { lng: 139.71, lat: 35.545 },
      { lng: 139.772, lat: 35.537 },
    ],
  },
  {
    name: "Osaka–Tokyo–Sendai",
    target: [
      { lng: 135.5, lat: 34.693 },
      { lng: 136.881, lat: 35.17 },
      { lng: 139.767, lat: 35.681 },
      { lng: 140.882, lat: 38.268 },
    ],
  },
  {
    name: "Box: Kanto",
    target: { west: 138.4, south: 34.9, east: 140.9, north: 36.9 },
  },
  {
    name: "Box: Fiji (antimeridian)",
    target: { west: 177, south: -19.5, east: -179, north: -16 },
  },
];

const overlay = new OverlayPlugin({ maxDistance: 1e8 });
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

const initialSet = new URLSearchParams(location.search).get("initial");
const initialFit =
  initialSet === null
    ? undefined
    : view.fitBounds(SETS[Number(initialSet)].target, { padding: 40 });
if (!initialFit) {
  view.setCamera({
    lng: 139.7671,
    lat: 35.6812,
    height: 2_000_000,
    heading: 0,
    pitch: -90,
    roll: 0,
  });
}

const params = {
  set: 0,
  keepOrientation: false,
  heading: 0,
  pitch: -45,
  top: 40,
  right: 40,
  bottom: 40,
  left: 40,
  duration: 1500,
};

const layer = document.createElement("div");
layer.style.cssText =
  "position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 10;";
document.body.appendChild(layer);

const frame = document.createElement("div");
frame.style.cssText =
  "position: absolute; border: 2px dashed #0090ff; box-sizing: border-box;";
layer.appendChild(frame);
const drawFrame = () => {
  frame.style.left = `${params.left}px`;
  frame.style.top = `${params.top}px`;
  frame.style.right = `${params.right}px`;
  frame.style.bottom = `${params.bottom}px`;
};
drawFrame();

const markers: HTMLDivElement[] = [];
const readout = {
  status: "",
  extentX: "",
  extentY: "",
  marginLeft: 0,
  marginRight: 0,
  marginTop: 0,
  marginBottom: 0,
};

const round = (v: number) => Math.round(v * 100) / 100;

overlay.onUpdate(({ projected }) => {
  const points = [...projected.values()];
  markers.forEach((marker, i) => {
    const pos = projected.get(String(i));
    marker.style.display = pos ? "block" : "none";
    if (pos) moveOverlayElement(marker, pos.x, pos.y);
  });
  if (points.length === 0) return;
  const size = view.screenSize;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  readout.extentX = `${round(minX)} – ${round(maxX)}`;
  readout.extentY = `${round(minY)} – ${round(maxY)}`;
  readout.marginLeft = round(minX - params.left);
  readout.marginRight = round(size.x - params.right - maxX);
  readout.marginTop = round(minY - params.top);
  readout.marginBottom = round(size.y - params.bottom - maxY);
});

const showSet = (set: FitSet) => {
  const positions = markerPositions(set.target);
  for (const marker of markers.splice(positions.length)) marker.remove();
  while (markers.length < positions.length) {
    const marker = document.createElement("div");
    marker.style.cssText =
      "position: absolute; left: -6px; top: -6px; width: 12px; height: 12px;" +
      "border-radius: 50%; background: #e5484d; border: 2px solid #fff;" +
      "box-sizing: border-box; box-shadow: 0 1px 3px rgb(0 0 0 / 0.5);";
    layer.appendChild(marker);
    markers.push(marker);
  }
  overlay.setPositions(
    positions.map((p, i) => ({
      id: String(i),
      lng: p.lng,
      lat: p.lat,
      alt: p.height ?? 0,
    })),
  );
};

const fit = async (index = params.set) => {
  params.set = index;
  const set = SETS[index];
  showSet(set);
  drawFrame();
  readout.status = `flying: ${set.name}`;
  const completed = await view.fitBounds(set.target, {
    padding: {
      top: params.top,
      right: params.right,
      bottom: params.bottom,
      left: params.left,
    },
    heading: params.keepOrientation ? undefined : params.heading,
    pitch: params.keepOrientation ? undefined : params.pitch,
    duration: params.duration,
  });
  readout.status = `${completed ? "settled" : "interrupted"}: ${set.name}`;
  return completed;
};

const pane = new Pane({ title: "fitBounds" });
const sets = pane.addFolder({ title: "Fit" });
SETS.forEach((set, i) => {
  sets.addButton({ title: set.name }).on("click", () => void fit(i));
});
const options = pane.addFolder({ title: "Options" });
options.addBinding(params, "keepOrientation", {
  label: "keep heading/pitch",
});
options.addBinding(params, "heading", { min: 0, max: 360, step: 1 });
options.addBinding(params, "pitch", { min: -90, max: -10, step: 1 });
for (const side of ["top", "right", "bottom", "left"] as const) {
  options
    .addBinding(params, side, { min: 0, max: 400, step: 1 })
    .on("change", drawFrame);
}
options.addBinding(params, "duration", { min: 0, max: 5000, step: 100 });
const out = pane.addFolder({ title: "Projected extent (CSS px)" });
for (const key of Object.keys(readout) as (keyof typeof readout)[]) {
  out.addBinding(readout, key, { readonly: true, interval: 200 });
}

/** For scripts: fit a set with overrides, then read `readout` a frame later. */
Object.assign(window, {
  fitBoundsDebug: {
    params,
    readout,
    sets: SETS.map((s) => s.name),
    view,
    fit: (index: number, overrides: Partial<typeof params> = {}) => {
      Object.assign(params, overrides);
      pane.refresh();
      return fit(index);
    },
    /** Leaves only the readout open, for screenshots. */
    compact: () => {
      sets.expanded = false;
      options.expanded = false;
    },
  },
});

view.attribution?.add([TILE_DATASETS.openstreetmap]);

if (initialFit) {
  showSet(SETS[Number(initialSet)]);
  readout.status = `initial: ${await initialFit}`;
}
