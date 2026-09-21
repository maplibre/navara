import ThreeView, { Color, type TextFacing } from "@navaramap/three";
import { Pane } from "tweakpane";

import { FONT_DATASETS, TILE_DATASETS } from "../../../helpers/constants";
import {
  addCameraControl,
  addHidePaneKeyShortcut,
} from "../../../helpers/control";

const CENTER = { lng: 139.7671, lat: 35.6812 };

// A cross of labels around the center, so the effect of the orientation
// options is visible at several bearings at once.
const OFFSETS_DEG = 0.004;
const LABELS = [
  { text: "CENTER", dLng: 0, dLat: 0 },
  { text: "NORTH", dLng: 0, dLat: OFFSETS_DEG },
  { text: "SOUTH", dLng: 0, dLat: -OFFSETS_DEG },
  { text: "EAST", dLng: OFFSETS_DEG, dLat: 0 },
  { text: "WEST", dLng: -OFFSETS_DEG, dLat: 0 },
];

const view = new ThreeView();
await view.init();

view.setCamera({
  lng: CENTER.lng,
  lat: CENTER.lat,
  distance: 1800,
  heading: 0,
  pitch: -40,
  roll: 0,
});

const basemap = view.addSource({
  type: "raster-tile",
  url: TILE_DATASETS.openstreetmap.url,
  maxZoom: 19,
});
view.addLayer({ type: "raster", source: basemap });

const source = view.addSource({
  type: "geojson",
  data: {
    type: "FeatureCollection",
    features: LABELS.map(({ text, dLng, dLat }) => ({
      type: "Feature" as const,
      properties: { name: text },
      geometry: {
        type: "Point" as const,
        coordinates: [CENTER.lng + dLng, CENTER.lat + dLat],
      },
    })),
  },
});

const params = {
  textFacing: "flat" as TextFacing,
  rotateWithCamera: true,
  rotation: 0,
  sizeInMeters: true,
  size: 60,
};

const layer = view.addLayer({
  type: "vector",
  source,
  text: {
    font: FONT_DATASETS.Roboto.url,
    color: new Color().setStyle("#ffffff"),
    outlineColor: new Color().setStyle("#000000"),
    outlineWidth: 3,
    clampToGround: true,
    // Bottom-aligned, so an upright signboard stands on its anchor instead of
    // sinking half of itself below the surface.
    center: { x: 0.5, y: 0.0 },
    textFacing: params.textFacing,
    rotateWithCamera: params.rotateWithCamera,
    rotation: params.rotation,
    sizeInMeters: params.sizeInMeters,
    size: params.size,
    // Overlapping is the point of this page; decluttering would hide the
    // very labels that show the orientation difference.
    declutter: false,
  },
});

layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => ({ text: properties?.name as string }),
    {
      filters: ["name"],
    },
  );
});

const pane = new Pane({ title: "Text facing" });
addCameraControl(view, pane);
addHidePaneKeyShortcut(pane);

pane
  .addBinding(params, "textFacing", {
    options: { upright: "upright", flat: "flat" },
  })
  .on("change", ({ value }) => layer.update({ text: { textFacing: value } }));

pane
  .addBinding(params, "rotateWithCamera")
  .on("change", ({ value }) =>
    layer.update({ text: { rotateWithCamera: value } }),
  );

pane
  .addBinding(params, "rotation", { min: -180, max: 180, step: 1 })
  .on("change", ({ value }) => layer.update({ text: { rotation: value } }));

pane
  .addBinding(params, "sizeInMeters")
  .on("change", ({ value }) => layer.update({ text: { sizeInMeters: value } }));

pane
  .addBinding(params, "size", { min: 10, max: 200, step: 1 })
  .on("change", ({ value }) => layer.update({ text: { size: value } }));

view.attribution?.add([TILE_DATASETS.openstreetmap, FONT_DATASETS.Roboto]);
