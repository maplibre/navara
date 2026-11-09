import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

import {
  FONT_DATASETS,
  TERRAIN_DATASETS,
  TILE_DATASETS,
  TILES_3D_DATASETS,
  VECTOR_DATASETS,
} from "../../../helpers/constants";

// Two independent ThreeViews side by side, each streaming heavy data of its
// own. They share the page-wide worker pool: disposing one must leave the
// other streaming tiles, and once both are disposed a new view must
// initialize again.

type Status = "disposed" | "initializing" | "initialized" | "failed";

/** Adds a pane's data once its view is initialized. */
type Content = (
  view: ThreeView<DefaultDescriptions>,
  plugin: DefaultPlugin,
) => void;

type Pane = {
  name: string;
  addContent: Content;
  root: HTMLDivElement;
  canvas?: HTMLCanvasElement;
  view?: ThreeView<DefaultDescriptions>;
  setStatus: (status: Status, detail?: string) => void;
};

const BUTTON_STYLE =
  "padding:6px 12px;border-radius:4px;border:none;color:#fff;cursor:pointer;font-size:13px;";

function createLayout() {
  document.body.style.margin = "0";
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:100vw;height:100vh;gap:4px;";
  document.body.appendChild(container);

  const toolbar = document.createElement("div");
  toolbar.style.cssText =
    "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:1000;display:flex;gap:8px;background:rgba(0,0,0,0.75);padding:8px 12px;border-radius:8px;";
  document.body.appendChild(toolbar);

  return { container, toolbar };
}

function addButton(parent: HTMLElement, label: string, color: string) {
  const button = document.createElement("button");
  button.textContent = label;
  button.style.cssText = BUTTON_STYLE + `background:${color};`;
  parent.appendChild(button);
  return button;
}

function createPane(
  container: HTMLElement,
  name: string,
  addContent: Content,
): Pane {
  const root = document.createElement("div");
  root.style.cssText = "position:relative;flex:1;background:#222;";
  container.appendChild(root);

  const panel = document.createElement("div");
  panel.style.cssText =
    "position:absolute;top:12px;left:12px;z-index:10;display:flex;align-items:center;gap:8px;background:rgba(0,0,0,0.75);color:#fff;padding:8px 12px;border-radius:8px;font:13px sans-serif;";
  root.appendChild(panel);

  const label = document.createElement("span");
  panel.appendChild(label);

  const pane: Pane = {
    name,
    addContent,
    root,
    setStatus: (status, detail) => {
      label.textContent = `${name}: ${status}${detail ? ` (${detail})` : ""}`;
      label.dataset.status = status;
      init.disabled = status === "initializing" || status === "initialized";
      dispose.disabled = status !== "initialized";
    },
  };

  const init = addButton(panel, "Init", "#4caf50");
  const dispose = addButton(panel, "Dispose", "#f44336");
  init.onclick = () => initialize(pane);
  dispose.onclick = () => disposeView(pane);
  pane.setStatus("disposed");
  return pane;
}

async function initialize(pane: Pane) {
  pane.setStatus("initializing");

  // A fresh canvas per view: a disposed WebGLRenderer leaves its context on
  // the old canvas.
  pane.canvas?.remove();
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;display:block;";
  pane.root.appendChild(canvas);
  pane.canvas = canvas;

  const view = new ThreeView<DefaultDescriptions>({ canvas });
  pane.view = view;

  const plugin = new DefaultPlugin();
  view.addPlugin(plugin);
  try {
    await view.init();
  } catch (e) {
    console.error(`${pane.name} init failed:`, e);
    if (pane.view !== view) return;
    disposeView(pane);
    pane.setStatus("failed", e instanceof Error ? e.message : String(e));
    return;
  }
  // "Dispose both" may have disposed this view while it initialized.
  if (pane.view !== view) return;

  pane.addContent(view, plugin);
  view.setCamera(CAMERA);
  // Noon in Tokyo, so both panes are lit the same whenever the page runs.
  view.atmosphere.date = new Date("2026-06-01T03:00:00Z");

  pane.setStatus("initialized");
}

function disposeView(pane: Pane) {
  pane.view?.dispose();
  pane.view = undefined;
  pane.canvas?.remove();
  pane.canvas = undefined;
  pane.setStatus("disposed");
}

// Tokyo Station looking west over the Imperial Palace, inside both PLATEAU
// wards so either pane has buildings in view.
const CAMERA = {
  lng: 139.775,
  lat: 35.674,
  height: 1_200,
  heading: 300,
  pitch: -30,
  roll: 0,
};

const addGsiTerrain = (view: ThreeView<DefaultDescriptions>) => {
  const dem = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    maxZoom: 15,
    minZoom: 6,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  });
  view.addLayer({ type: "terrain", source: dem });
};

const addPlateauBuildings = (
  view: ThreeView<DefaultDescriptions>,
  datasets: (typeof TILES_3D_DATASETS)["plateauChiyoda" | "plateauChuo"][],
  color: string,
) => {
  for (const dataset of datasets) {
    const source = view.addSource({ type: "3d-tiles", url: dataset.url });
    view.addLayer({
      type: "3d-tiles",
      source,
      model: {
        color: new Color().setStyle(color),
        metalness: 0,
        roughness: 1,
      },
    });
  }
};

/** Aerial imagery draped on DEM terrain, with PLATEAU LOD2 buildings. */
const addRasterContent: Content = (view, plugin) => {
  plugin.addDefaultPhotorealScene();
  addGsiTerrain(view);
  const imagery = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.gsiSeamlessphoto.url,
    maxZoom: 18,
  });
  view.addLayer({ type: "raster", source: imagery });
  const buildings = [
    TILES_3D_DATASETS.plateauChiyoda,
    TILES_3D_DATASETS.plateauChuo,
  ];
  addPlateauBuildings(view, buildings, "#ffffff");
  view.attribution?.add([
    TILE_DATASETS.gsiSeamlessphoto,
    TERRAIN_DATASETS.gsi,
    ...buildings,
  ]);
};

/** GSI MVT water, roads and labels (labels load the font worker), with the
 *  Chiyoda buildings in an accent color. */
const addVectorContent: Content = (view) => {
  view.addLight({ ambient: { intensity: 0.6 } });
  view.addLight({ sun: { intensity: 1.8 } });
  addGsiTerrain(view);
  const gsiVector = view.addSource({
    type: "vector-tile",
    url: VECTOR_DATASETS.gsiExperimentalVector.url,
    maxZoom: 16,
  });
  view.addLayer({
    type: "vector",
    source: gsiVector,
    sourceLayers: ["waterarea"],
    polygon: {
      color: new Color().setStyle("#5ab4ff"),
      clampToGround: true,
    },
  });
  view.addLayer({
    type: "vector",
    source: gsiVector,
    sourceLayers: ["road"],
    polyline: {
      color: new Color().setStyle("#ff6b2c"),
      width: 3,
      clampToGround: true,
    },
  });
  const labels = view.addLayer({
    type: "vector",
    source: gsiVector,
    sourceLayers: ["label"],
    text: {
      lang: "ja",
      font: FONT_DATASETS.LineSeedJP.url,
      color: new Color().setStyle("#1d2733"),
      outlineColor: new Color().setStyle("#ffffff"),
      outlineWidth: 2,
      size: 16,
      sizeInMeters: false,
      clampToGround: true,
      declutter: true,
    },
  });
  labels.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        const text = properties?.["knj"] as string | undefined;
        return { text: text ?? "", show: !!text };
      },
      { filters: ["knj"] },
    );
  });
  addPlateauBuildings(view, [TILES_3D_DATASETS.plateauChiyoda], "#0091ff");
  view.attribution?.add([
    VECTOR_DATASETS.gsiExperimentalVector,
    FONT_DATASETS.LineSeedJP,
    TERRAIN_DATASETS.gsi,
    TILES_3D_DATASETS.plateauChiyoda,
  ]);
};

export function run() {
  const { container, toolbar } = createLayout();
  const panes = [
    createPane(container, "View A", addRasterContent),
    createPane(container, "View B", addVectorContent),
  ];

  // Concurrent init is the case where both views race for the worker pool
  // and the WASM module.
  addButton(toolbar, "Init both", "#4caf50").onclick = () => {
    for (const pane of panes) {
      if (!pane.view) initialize(pane);
    }
  };
  addButton(toolbar, "Dispose both", "#f44336").onclick = () => {
    for (const pane of panes) disposeView(pane);
  };

  // `#a` / `#b` starts a single pane: the single-view baseline.
  const only = location.hash.slice(1);
  panes.forEach((pane, i) => {
    if (!only || only === "ab"[i]) initialize(pane);
  });
}
