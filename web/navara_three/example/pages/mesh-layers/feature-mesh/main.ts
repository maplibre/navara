import ThreeView, {
  Color,
  geodeticToVector3,
  headingPitchRollToFixedFrame,
  vector3ToGeodetic,
  type XYZ,
  type LatLngHeight,
  type MeshHandle,
} from "@navaramap/three";
import type {
  PolygonMeshDesc,
  PolylineMeshDesc,
  SphereMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { MathUtils, Vector3 } from "three";
import { Pane } from "tweakpane";

import { TERRAIN_DATASETS, TILE_DATASETS } from "../../../helpers/constants";
import { addDateControl } from "../../../helpers/control";

const view = new ThreeView<DefaultDescriptions>({ shadow: true });

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);

await view.init();

defaultPlugin.addDefaultPhotorealScene();
view.addLight({ ambient: { intensity: 0.4 } });

view.setCamera({
  lng: 138.73,
  lat: 35.29,
  height: 9000,
  heading: 0,
  pitch: -45,
  roll: 0,
});

const osm = view.addSource({
  type: "raster-tile",
  url: TILE_DATASETS.openstreetmap.url,
  maxZoom: 18,
});
view.addLayer({ type: "raster", source: osm });

// Vertex normals make the globe write the normals draped shapes are lit with.
const terrain = view.addSource({
  type: "quantized-mesh",
  url: TERRAIN_DATASETS.reearthQuantizedMesh.url,
  maxZoom: 18,
  requestVertexNormals: true,
});
view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { castShadow: true, receiveShadow: true },
});

// Marker radius in screen pixels; meshes are sized in metres, so markers are
// rescaled by their camera distance every frame.
const MARKER_PIXELS = 6;
// `width` is in pixels but capped at `maxWidth` metres; lift the cap so lines
// keep their width at globe scale.
const MAX_LINE_WIDTH = 1e7;
const MARKER_COLOR = new Color().setStyle("#ffffff");
const START_MARKER_COLOR = new Color().setStyle("#ffcc33");

type Style = {
  color: string;
  highlightColor: string;
  opacity: number;
  transparent: boolean;
  clampToGround: boolean;
  height: number;
  extrudedHeight: number;
  asLine: boolean;
  width: number;
  useGroundNormals: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  // Placement of the shape's local frame, as for any other mesh.
  heading: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  scale: number;
};

type Shape = {
  // `points` are in the frame `geodetic: origin` places, so the transform
  // fields move the whole shape.
  origin: LatLngHeight;
  points: XYZ[];
  style: Style;
  polygon: MeshHandle<PolygonMeshDesc>;
  line: MeshHandle<PolylineMeshDesc>;
};

const shapes: Shape[] = [];
let selected: Shape | undefined;

// Points of the polygon being drawn.
let draft: LatLngHeight[] = [];
let markers: MeshHandle<SphereMeshDesc>[] = [];
let draftLine: MeshHandle<PolylineMeshDesc> | undefined;

const defaultStyle = (): Style => ({
  color: "#0091ff",
  highlightColor: "#ff6b2c",
  opacity: 0.6,
  transparent: true,
  clampToGround: true,
  height: 0,
  extrudedHeight: 0,
  asLine: false,
  width: 4,
  useGroundNormals: true,
  castShadow: true,
  receiveShadow: true,
  heading: 0,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  scale: 1,
});

// Unclamped shapes are drawn at `height`, not at their positions' heights;
// start from the lowest point so they do not sink into the slope.
const baseHeight = (ring: LatLngHeight[]) =>
  Math.min(...ring.map((p) => p.height));

// The picked point lies on the rendered mesh, which sinks kilometres below
// the ellipsoid at globe scale; the terrain data gives the real height.
const pickGround = (clientX: number, clientY: number) => {
  const position = view.pickTerrainPosition(clientX, clientY);
  if (!position) return undefined;
  const point = vector3ToGeodetic(position);
  return { ...point, height: view.sampleTerrainHeight(point) ?? point.height };
};

const displayColor = (shape: Shape) =>
  new Color().setStyle(
    shape === selected ? shape.style.highlightColor : shape.style.color,
  );

const placement = ({ origin, style }: Shape) => ({
  geodetic: { ...origin, heading: style.heading },
  position: { x: style.offsetX, y: style.offsetY, z: style.offsetZ },
  scale: { x: style.scale, y: style.scale, z: style.scale },
});

const applyStyle = (shape: Shape) => {
  const { style } = shape;
  const color = displayColor(shape);
  // Extrusion needs `clampToGround: false`; a draped polygon stays flat.
  shape.polygon.update({
    ...placement(shape),
    polygon: {
      color,
      opacity: style.opacity,
      transparent: style.transparent,
      clampToGround: style.clampToGround,
      height: style.height,
      extrudedHeight: style.extrudedHeight,
      useGroundNormals: style.useGroundNormals,
      castShadow: style.castShadow,
      receiveShadow: style.receiveShadow,
    },
  });
  shape.line.update({
    ...placement(shape),
    polyline: {
      color,
      width: style.width,
      clampToGround: style.clampToGround,
      height: style.height,
      useGroundNormals: style.useGroundNormals,
      castShadow: style.castShadow,
      receiveShadow: style.receiveShadow,
    },
  });
  shape.polygon.visible = !style.asLine;
  shape.line.visible = style.asLine;
};

const markerScale = (point: LatLngHeight): XYZ => {
  const camera = view.camera.raw;
  const distance = camera.position.distanceTo(geodeticToVector3(point));
  const metersPerPixel =
    (2 * distance * Math.tan(MathUtils.degToRad(camera.fov) / 2)) /
    view.canvas.clientHeight;
  const s = metersPerPixel * MARKER_PIXELS;
  return { x: s, y: s, z: s };
};

// Skips tiny changes: each update requests another frame.
const rescale = (marker: MeshHandle<SphereMeshDesc>, point: LatLngHeight) => {
  const scale = markerScale(point);
  const current = marker.ref.raw?.scale.x ?? 0;
  if (Math.abs(scale.x - current) > current * 0.01) {
    marker.update({ scale });
  }
};

const clearDraft = () => {
  for (const marker of markers) marker.delete();
  draftLine?.delete();
  draft = [];
  markers = [];
  draftLine = undefined;
};

const addDraftPoint = (point: LatLngHeight) => {
  draft.push(point);
  markers.push(
    view.addMesh<SphereMeshDesc>({
      sphere: {
        color: markers.length === 0 ? START_MARKER_COLOR : MARKER_COLOR,
      },
      geodetic: point,
      scale: markerScale(point),
      lit: false,
      // Only the start point is clicked, to close the ring.
      pickable: markers.length === 0,
    }),
  );

  if (draft.length < 2) return;
  if (draftLine) {
    draftLine.update({ polyline: { positions: draft } });
  } else {
    draftLine = view.addMesh<PolylineMeshDesc>({
      polyline: {
        positions: draft,
        color: MARKER_COLOR,
        width: 3,
        maxWidth: MAX_LINE_WIDTH,
        clampToGround: true,
      },
      lit: false,
    });
  }
};

// Where the next click would put a point, and the edge it would add.
const cursorMarker = view.addMesh<SphereMeshDesc>({
  sphere: {
    color: MARKER_COLOR,
    transparent: true,
    opacity: 0.5,
  },
  geodetic: { lng: 0, lat: 0, height: 0 },
  lit: false,
  visible: false,
});
let cursorLine: MeshHandle<PolylineMeshDesc> | undefined;
let cursorPoint: LatLngHeight | undefined;

const hideCursor = () => {
  cursorMarker.visible = false;
  if (cursorLine) cursorLine.visible = false;
};

const updateCursor = (clientX: number, clientY: number) => {
  const point = selected ? undefined : pickGround(clientX, clientY);
  if (!point) {
    hideCursor();
    return;
  }
  cursorPoint = point;
  cursorMarker.update({ geodetic: point, scale: markerScale(point) });
  cursorMarker.visible = true;

  const last = draft[draft.length - 1];
  // A line needs two distinct positions.
  if (!last || (last.lng === point.lng && last.lat === point.lat)) {
    if (cursorLine) cursorLine.visible = false;
    return;
  }
  const positions = [last, point];
  if (cursorLine) {
    cursorLine.update({ polyline: { positions } });
  } else {
    cursorLine = view.addMesh<PolylineMeshDesc>({
      polyline: {
        positions,
        color: MARKER_COLOR,
        width: 3,
        maxWidth: MAX_LINE_WIDTH,
        transparent: true,
        opacity: 0.25,
        clampToGround: true,
      },
      lit: false,
    });
  }
  cursorLine.visible = true;
};

const closeDraft = () => {
  const ring = [...draft, draft[0]];
  const height = baseHeight(ring);
  // The vertex centroid, so `heading` and `scale` act around the middle.
  const centroid = draft
    .reduce((sum, p) => sum.add(geodeticToVector3(p)), new Vector3())
    .divideScalar(draft.length);
  const origin = { ...vector3ToGeodetic(centroid), height };
  // Local positions in the west-up-north frame `geodetic: origin` places.
  const toLocal = headingPitchRollToFixedFrame(origin).invert();
  const points = ring.map((p) => geodeticToVector3(p).applyMatrix4(toLocal));
  const style = { ...defaultStyle(), height };
  const shape: Shape = {
    origin,
    points,
    style,
    polygon: view.addMesh<PolygonMeshDesc>({
      polygon: { points },
      geodetic: origin,
      pickable: true,
    }),
    line: view.addMesh<PolylineMeshDesc>({
      polyline: { points, ring: true, maxWidth: MAX_LINE_WIDTH },
      geodetic: origin,
      pickable: true,
    }),
  };
  shapes.push(shape);
  applyStyle(shape);
  clearDraft();
  select(shape);
};

// --- Panel ---

const pane = new Pane({ title: "Polygon editor" });
if (pane.element.parentElement)
  pane.element.parentElement.style.width = "320px";

const drawFolder = pane.addFolder({ title: "Draw" });
const drawInfo = { help: "" };
drawFolder.addBinding(drawInfo, "help", {
  readonly: true,
  multiline: true,
  rows: 3,
  label: undefined,
});
drawFolder.addButton({ title: "Cancel drawing" }).on("click", () => {
  clearDraft();
  refreshPanel();
});

const params = defaultStyle();
const editFolder = pane.addFolder({ title: "Selected polygon" });

const editSelected = (patch: Partial<Style>) => {
  if (!selected) return;
  Object.assign(selected.style, patch);
  applyStyle(selected);
};

editFolder
  .addBinding(params, "color")
  .on("change", ({ value }) => editSelected({ color: value }));
editFolder
  .addBinding(params, "highlightColor")
  .on("change", ({ value }) => editSelected({ highlightColor: value }));
editFolder
  .addBinding(params, "transparent")
  .on("change", ({ value }) => editSelected({ transparent: value }));
editFolder
  .addBinding(params, "opacity", { min: 0, max: 1, step: 0.05 })
  .on("change", ({ value }) => editSelected({ opacity: value }));
editFolder.addBinding(params, "clampToGround").on("change", ({ value }) => {
  editSelected({ clampToGround: value });
  heightBinding.disabled = value;
  extrudedHeightBinding.disabled = value;
});
// Base height in metres above the ellipsoid; ignored while clamped.
const heightBinding = editFolder
  .addBinding(params, "height", { min: -500, max: 5000, step: 10 })
  .on("change", ({ value }) => editSelected({ height: value }));
const extrudedHeightBinding = editFolder
  .addBinding(params, "extrudedHeight", { min: 0, max: 2000, step: 50 })
  .on("change", ({ value }) => editSelected({ extrudedHeight: value }));
editFolder
  .addBinding(params, "asLine")
  .on("change", ({ value }) => editSelected({ asLine: value }));
// Width is in screen pixels.
editFolder
  .addBinding(params, "width", { min: 1, max: 30, step: 1 })
  .on("change", ({ value }) => editSelected({ width: value }));
// Shades a clamped shape with the terrain normal, else the ellipsoid normal.
editFolder
  .addBinding(params, "useGroundNormals")
  .on("change", ({ value }) => editSelected({ useGroundNormals: value }));
// Clamped shapes cast no shadow and receive it on the ground.
editFolder
  .addBinding(params, "castShadow")
  .on("change", ({ value }) => editSelected({ castShadow: value }));
editFolder
  .addBinding(params, "receiveShadow")
  .on("change", ({ value }) => editSelected({ receiveShadow: value }));

// The transform fields every mesh takes: `geodetic` places the local frame
// (x west, y up, z north) at the vertex centroid, and `position` and `scale`
// act inside it.
const transformFolder = editFolder.addFolder({ title: "Transform" });
transformFolder
  .addBinding(params, "heading", { min: -180, max: 180, step: 1 })
  .on("change", ({ value }) => editSelected({ heading: value }));
transformFolder
  .addBinding(params, "offsetX", {
    label: "x (west)",
    min: -2000,
    max: 2000,
    step: 10,
  })
  .on("change", ({ value }) => editSelected({ offsetX: value }));
transformFolder
  .addBinding(params, "offsetY", {
    label: "y (up)",
    min: -500,
    max: 2000,
    step: 10,
  })
  .on("change", ({ value }) => editSelected({ offsetY: value }));
transformFolder
  .addBinding(params, "offsetZ", {
    label: "z (north)",
    min: -2000,
    max: 2000,
    step: 10,
  })
  .on("change", ({ value }) => editSelected({ offsetZ: value }));
transformFolder
  .addBinding(params, "scale", { min: 0.1, max: 3, step: 0.05 })
  .on("change", ({ value }) => editSelected({ scale: value }));
editFolder
  .addButton({ title: "Deselect" })
  .on("click", () => select(undefined));
editFolder.addButton({ title: "Delete" }).on("click", () => {
  if (!selected) return;
  const shape = selected;
  select(undefined);
  shape.polygon.delete();
  shape.line.delete();
  shapes.splice(shapes.indexOf(shape), 1);
});

const refreshPanel = () => {
  editFolder.hidden = !selected;
  drawFolder.hidden = !!selected;
  drawInfo.help =
    draft.length === 0
      ? "Click the terrain to start a polygon."
      : draft.length < 3
        ? "Click to add points."
        : "Click to add points, or click the yellow start point to close.";
  if (selected) Object.assign(params, selected.style);
  heightBinding.disabled = params.clampToGround;
  extrudedHeightBinding.disabled = params.clampToGround;
  pane.refresh();
};

function select(shape: Shape | undefined) {
  const previous = selected;
  selected = shape;
  if (previous) applyStyle(previous);
  if (shape) {
    applyStyle(shape);
    hideCursor();
  }
  refreshPanel();
}

refreshPanel();

// Starts in the late morning in Japan, so the sun lights the extruded walls.
addDateControl(view, pane, new Date("2026-07-16T01:00:00Z"));

// --- Input ---

// `featureClick` runs before `click` for the same gesture.
let pickedBatchId: number | undefined;
view.on("featureClick", (info) => {
  pickedBatchId = info?.batchId;
});

view.on("click", (event) => {
  const batchId = pickedBatchId;
  pickedBatchId = undefined;

  if (draft.length > 0) {
    if (batchId === markers[0]?.ref.batchId) {
      if (draft.length >= 3) closeDraft();
      return;
    }
  } else {
    const shape = shapes.find(
      (s) =>
        batchId !== undefined &&
        (s.polygon.ref.batchId === batchId || s.line.ref.batchId === batchId),
    );
    if (shape || selected) {
      select(shape);
      return;
    }
  }

  const point = pickGround(event.clientX, event.clientY);
  if (!point) return;
  addDraftPoint(point);
  updateCursor(event.clientX, event.clientY);
  refreshPanel();
});

view.on("pointermove", (event) => updateCursor(event.clientX, event.clientY));

view.on("postUpdate", () => {
  markers.forEach((marker, i) => rescale(marker, draft[i]));
  if (cursorPoint && cursorMarker.visible) rescale(cursorMarker, cursorPoint);
});
view.on("pointerleave", hideCursor);

view.attribution?.add([
  TILE_DATASETS.openstreetmap,
  TERRAIN_DATASETS.reearthQuantizedMesh,
]);
