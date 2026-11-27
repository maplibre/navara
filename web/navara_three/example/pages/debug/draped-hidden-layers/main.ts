import ThreeView, { JAPAN_GSI_ELEVATION_DECODER } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { TERRAIN_DATASETS, TILE_DATASETS } from "../../../helpers/constants";

/**
 * Six raster layers on terrain, one of them hidden. On a GPU with 16 texture
 * units a terrain tile has 5 raster slots (the pane shows `rasterSlots` for
 * this device), so the six only fit because a hidden layer takes no slot:
 * every shown layer draws and no error is logged. Showing the hidden layer
 * there goes past the limit: the topmost layer (band D) is dropped and the
 * "Too many layers draped" error is counted.
 *
 * Bottom to top: a GSI photo, bands A and B (B hidden), a semi-transparent
 * hillshade, bands C and D. Each band tile is transparent except one coloured
 * column, so each band layer shows as its own column on every tile: a layer
 * drawn from the wrong slot shows the wrong colour or the wrong column.
 */

// Count the slot overflow errors (also the wording before it was changed).
let overflowErrors = 0;
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const message = String(args[0]);
  if (
    message.startsWith("Too many layers draped") ||
    message.startsWith("Exceeded maximum textures")
  ) {
    overflowErrors++;
  }
  consoleError(...args);
};

const view = new ThreeView<DefaultDescriptions>({ debug: true });
view.addPlugin(new DefaultPlugin());
await view.init();
// The hillshade layer shades the terrain from the lights.
view.addLight({ ambient: { intensity: 1 } });
view.addLight({ sun: { intensity: 2 } });

// The raster slot count of a terrain tile on this device, as documented on
// the raster layer page (no elevationHeatmap layer on this page).
const gl = view.canvas.getContext("webgl2");
const maxTextureUnits = gl?.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) ?? 16;
const units = Math.max(maxTextureUnits, 8) - 6;
const rasterSlots = units - Math.floor(units / 2);

const BANDS = [
  { name: "band A", color: "#ff2d2d" },
  { name: "band B", color: "#2dd4ff" },
  { name: "band C", color: "#ffd52d" },
  { name: "band D", color: "#b02dff" },
];

const bandTile = (index: number, color: string): string => {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable");
  const width = size / BANDS.length;
  ctx.fillStyle = color;
  ctx.fillRect(index * width, 0, width, size);
  ctx.fillStyle = "#000";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(BANDS[index].name.slice(-1), index * width + 20, size / 2);
  return canvas.toDataURL("image/png");
};

const dem = view.addSource({
  type: "raster-dem",
  url: TERRAIN_DATASETS.gsi.url,
  elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  minZoom: 5,
  maxZoom: 14,
});
view.addLayer({ type: "terrain", source: dem });

const photo = view.addLayer({
  type: "raster",
  source: view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.gsiSeamlessphoto.url,
    maxZoom: 18,
  }),
});
const band = (index: number, show: boolean) =>
  view.addLayer({
    type: "raster",
    source: view.addSource({
      type: "raster-tile",
      url: bandTile(index, BANDS[index].color),
      maxZoom: 18,
    }),
    raster: { show, opacity: 0.85 },
  });
const bandA = band(0, true);
const bandB = band(1, false);
const hillshade = view.addLayer({
  type: "raster",
  source: dem,
  hillshade: { exaggeration: 1 },
  raster: { opacity: 0.6 },
});
const bandC = band(2, true);
const bandD = band(3, true);

view.setCamera({
  lng: 138.73,
  lat: 35.2,
  height: 9000,
  heading: 0,
  pitch: -40,
  roll: 0,
});

const layers = [
  { name: "photo", layer: photo, show: true },
  { name: "band A", layer: bandA, show: true },
  { name: "band B", layer: bandB, show: false },
  { name: "hillshade", layer: hillshade, show: true },
  { name: "band C", layer: bandC, show: true },
  { name: "band D", layer: bandD, show: true },
];

const readout = {
  maxTextureUnits,
  rasterSlots,
  shown: 0,
  overflowErrors: 0,
};
const updateShown = () => {
  readout.shown = layers.filter((l) => l.show).length;
};
updateShown();

const pane = new Pane({ title: "Draped hidden layers" });
const layerFolder = pane.addFolder({ title: "show" });
for (const entry of layers) {
  layerFolder
    .addBinding(entry, "show", { label: entry.name })
    .on("change", ({ value }) => {
      entry.layer.update({ raster: { show: value } });
      updateShown();
    });
}
const info = pane.addFolder({ title: "slots" });
info.addBinding(readout, "maxTextureUnits", { readonly: true });
info.addBinding(readout, "rasterSlots", { readonly: true });
info.addBinding(readout, "shown", { readonly: true });
info.addBinding(readout, "overflowErrors", { readonly: true, interval: 200 });

setInterval(() => {
  readout.overflowErrors = overflowErrors;
}, 200);

// Read by the Playwright capture script.
Object.assign(window, {
  __drapedHiddenLayers: {
    readout,
    setShow: (name: string, show: boolean) => {
      const entry = layers.find((l) => l.name === name);
      if (!entry) throw new Error(`Unknown layer: ${name}`);
      entry.show = show;
      entry.layer.update({ raster: { show } });
      updateShown();
      pane.refresh();
    },
  },
});
