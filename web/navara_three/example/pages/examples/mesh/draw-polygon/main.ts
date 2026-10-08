import ThreeView, {
  Color,
  geodeticToVector3,
  vector3ToGeodetic,
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
import { TileJsonPlugin } from "@navaramap/three-plugins";
import { MathUtils, Raycaster, Vector2, Vector3 } from "three";

import { addControlsHelp } from "../../../../helpers/controlsHelp";
import { initializeExample } from "../../../../helpers/initialize";

import { sampleFootprint } from "./data";

const DRAWING_COLOR = new Color().setStyle("#0091ff");
const POLYGON_COLOR = new Color().setStyle("#ffffff");

const MARKER_PIXELS = 6;

const MIN_EXTRUDED_HEIGHT = 1;

const EDGE_LIFT = 2;

const view = new ThreeView<DefaultDescriptions>({
  shadow: true,
  backgroundColor: new Color().setStyle("#d0d0d0"),
});

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);

await view.init();

view.atmosphere.date = new Date("2026-07-15T23:00:00Z");
view.addLight({
  ambient: { color: new Color().setStyle("#ffffff"), intensity: 0.5 },
});

view.addLight({
  sun: {
    color: new Color().setStyle("#ffffff"),
    applyColor: true,
    intensity: 2.0,
    castShadow: true,
    shadowFar: 3000,
  },
});

view.setCamera({
  lng: 138.908,
  lat: 35.1685,
  height: 380,
  heading: 345,
  pitch: -16,
  roll: 0,
});

const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain",
  maxZoom: 18,
  requestVertexNormals: true,
});
view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { receiveShadow: true },
});

const basemap = await tilejson.addSource({
  type: "raster-tile",
  url: "https://papers.reearth.land/styles/papers-light/tilejson.json",
});
view.addLayer({ type: "raster", source: basemap });

addControlsHelp("Controls", [
  ["Add a point", "Click"],
  ["Close the shape", "Click the first point"],
  ["Set the height", "Move up / down"],
  ["Confirm", "Click"],
  ["Cancel", "Esc"],
]);

let points: LatLngHeight[] = [];
let markers: MeshHandle<SphereMeshDesc>[] = [];
let edge: MeshHandle<PolylineMeshDesc> | undefined;
let polygon: MeshHandle<PolygonMeshDesc> | undefined;
let baseHeight = 0;

const pickPoint = (clientX: number, clientY: number) => {
  const picked = view.pickTerrainPosition(clientX, clientY);
  if (!picked) return undefined;
  const point = vector3ToGeodetic(picked);
  return { ...point, height: view.sampleTerrainHeight(point) ?? point.height };
};

const markerScale = (point: LatLngHeight) => {
  const camera = view.camera.raw;
  const distance = camera.position.distanceTo(geodeticToVector3(point));
  const metersPerPixel =
    (2 * distance * Math.tan(MathUtils.degToRad(camera.fov) / 2)) /
    view.canvas.clientHeight;
  const s = metersPerPixel * MARKER_PIXELS;
  return { x: s, y: s, z: s };
};

const cursorMarker = view.addMesh<SphereMeshDesc>({
  sphere: { color: DRAWING_COLOR },
  geodetic: { lng: 0, lat: 0, height: 0 },
  lit: false,
  visible: false,
});
let cursorPoint: LatLngHeight | undefined;

const drawEdge = () => {
  const last = points[points.length - 1];
  const positions =
    cursorPoint &&
    !(last && last.lng === cursorPoint.lng && last.lat === cursorPoint.lat)
      ? [...points, cursorPoint]
      : points;

  if (positions.length < 2) {
    edge?.delete();
    edge = undefined;
  } else if (edge) {
    edge.update({ polyline: { positions } });
  } else {
    edge = view.addMesh<PolylineMeshDesc>({
      polyline: { positions, color: DRAWING_COLOR, width: 3 },
      lit: false,
    });
  }
};

const hideCursor = () => {
  cursorPoint = undefined;
  cursorMarker.visible = false;
};

const moveCursor = (clientX: number, clientY: number) => {
  cursorPoint = pickPoint(clientX, clientY);
  if (cursorPoint) {
    cursorMarker.update({
      geodetic: cursorPoint,
      scale: markerScale(cursorPoint),
    });
  }
  cursorMarker.visible = !!cursorPoint;
  drawEdge();
};

const addPoint = (point: LatLngHeight) => {
  markers.push(
    view.addMesh<SphereMeshDesc>({
      sphere: { color: DRAWING_COLOR },
      geodetic: point,
      scale: markerScale(point),
      lit: false,
      pickable: markers.length === 0,
    }),
  );
  points.push(point);
  drawEdge();
};

const closeShape = () => {
  const ring = [...points, points[0]];
  for (const marker of markers) marker.delete();
  markers = [];
  hideCursor();

  baseHeight = Math.min(...points.map((p) => p.height));
  polygon = view.addMesh<PolygonMeshDesc>({
    polygon: {
      positions: ring,
      color: POLYGON_COLOR,
      clampToGround: false,
      height: baseHeight,
      extrudedHeight: MIN_EXTRUDED_HEIGHT,
      castShadow: true,
      receiveShadow: true,
    },
  });

  edge?.update({
    polyline: {
      positions: ring,
      ring: true,
      color: DRAWING_COLOR,
      clampToGround: false,
      height: baseHeight + MIN_EXTRUDED_HEIGHT + EDGE_LIFT,
    },
  });
};

const raycaster = new Raycaster();
const pointer = new Vector2();
const onVertical = new Vector3();

const extrusionAt = (clientX: number, clientY: number) => {
  const rect = view.canvas.getBoundingClientRect();
  pointer.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, view.camera.raw);
  const [first] = points;
  raycaster.ray.distanceSqToSegment(
    geodeticToVector3({ ...first, height: baseHeight }),
    geodeticToVector3({ ...first, height: baseHeight + 10_000 }),
    undefined,
    onVertical,
  );
  const roofHeight = vector3ToGeodetic(onVertical).height;
  return Math.max(MIN_EXTRUDED_HEIGHT, roofHeight - baseHeight);
};

const setHeight = (extrudedHeight: number) => {
  polygon?.update({ polygon: { extrudedHeight } });
  edge?.update({
    polyline: { height: baseHeight + extrudedHeight + EDGE_LIFT },
  });
};

const resetDrawing = () => {
  edge?.delete();
  hideCursor();
  points = [];
  markers = [];
  edge = undefined;
  polygon = undefined;
};

const confirmShape = () => resetDrawing();

const cancelShape = () => {
  for (const marker of markers) marker.delete();
  polygon?.delete();
  resetDrawing();
};

let pickedBatchId: number | undefined;
view.on("featureClick", (info) => {
  pickedBatchId = info?.batchId;
});

view.on("click", (event) => {
  const batchId = pickedBatchId;
  pickedBatchId = undefined;

  if (polygon) return;
  if (points.length >= 3 && batchId === markers[0].ref.batchId) {
    closeShape();
    return;
  }
  const point = pickPoint(event.clientX, event.clientY);
  if (point) addPoint(point);
  moveCursor(event.clientX, event.clientY);
});

view.on("pointermove", (event) => {
  if (!polygon) moveCursor(event.clientX, event.clientY);
});

// `view` pointer events carry a position on the globe and so stop over the
// sky; setting the height needs only the cursor, so it follows window events.
window.addEventListener("pointermove", (event) => {
  if (polygon) setHeight(extrusionAt(event.clientX, event.clientY));
});

// A press and release in place on the map confirms; a camera drag does not.
let confirmPress: { x: number; y: number } | undefined;
window.addEventListener("pointerdown", (event) => {
  confirmPress =
    polygon && event.target === view.canvas
      ? { x: event.clientX, y: event.clientY }
      : undefined;
});
window.addEventListener("pointerup", (event) => {
  const press = confirmPress;
  confirmPress = undefined;
  if (!press) return;
  if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
  setHeight(extrusionAt(event.clientX, event.clientY));
  confirmShape();
});

view.on("pointerleave", () => {
  if (polygon) return;
  hideCursor();
  drawEdge();
});

const rescale = (marker: MeshHandle<SphereMeshDesc>, point: LatLngHeight) => {
  const scale = markerScale(point);
  const current = marker.ref.raw?.scale.x ?? 0;
  if (Math.abs(scale.x - current) > current * 0.01) marker.update({ scale });
};

view.on("postUpdate", () => {
  for (let i = 0; i < markers.length; i++) rescale(markers[i], points[i]);
  if (cursorPoint) rescale(cursorMarker, cursorPoint);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") cancelShape();
});

const sample = await view.sampleTerrainMostDetailed(terrain, sampleFootprint);
for (const { lng, lat, height } of sample) {
  addPoint({ lng, lat, height: height ?? 0 });
}
closeShape();
setHeight(60);
confirmShape();

view.attribution?.add([
  {
    attribution: "© Re:Earth Terrain",
    attributionUrl: "https://terrain.reearth.land/",
  },
]);

initializeExample(view);
