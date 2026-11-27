import ThreeView, {
  JAPAN_GSI_ELEVATION_DECODER,
  type MeshHandle,
  type PickedFeature,
  type Nullable,
  type XYZ,
  type MapPointerEvent,
  type Window,
  geodeticToVector3,
  vector3ToGeodetic,
  convertWorldToScreen,
  geodeticSurfaceNormal,
  eastNorthUpToFixedFrame,
  northEastDownToFixedFrame,
  northUpEastToFixedFrame,
  northWestUpToFixedFrame,
  getPlaneFromPointNormal,
  getHeightFromEllipsoid,
  getPickRay,
  getRayPlaneIntersection,
  EllipsoidGeodesic,
  Color,
  Source,
  type Layer,
} from "@navaramap/three";
import type {
  SphereMeshDesc,
  TubeMeshDesc,
  CylinderMeshDesc,
  GLTFModelDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Mesh, Vector2, Vector3, Object3D, Group, ArrowHelper } from "three";
import { Pane, FolderApi } from "tweakpane";

import {
  TERRAIN_DATASETS,
  TILE_DATASETS,
  TILES_3D_DATASETS,
  LOCAL_DATASETS,
} from "../../helpers/constants";
import { addCameraControl, addDateControl } from "../../helpers/control";

import { FloatingDialog } from "./dialog";

const gPaneParams = {
  convertScreenToWorld: false,
  sampleMostDetailed: false,
  extrudeCylinder: false,
  moveDistance: 0,
  transform: "northUpEast",

  lngStart: 127.6809,
  latStart: 26.2124,
  lngEnd: 86.925,
  latEnd: 27.9881,
  distance: 0,
  interpolate: 0,

  sampleLng: 0,
  sampleLat: 0,
  sampleTerrainHeight: 0,

  mostDetailedHeight: 0,
  mostDetailedLevel: 0,

  fujiHeight: 0,
  fujiRegistered: true,
  kitaHeight: 0,
  kitaRegistered: true,

  fov: 50,
  near: 100,
  far: 100000000,
};

const gFujiPos = [35.3624725342, 138.7306671143];
const gKitaPos = [35.6744, 138.2392];

let gModelNormalHandle: Nullable<MeshHandle<GLTFModelDesc>> = undefined;
let gModelFujiHandle: Nullable<MeshHandle<GLTFModelDesc>> = undefined;
let gPolylineLayer: Nullable<MeshHandle<TubeMeshDesc>> = undefined;
let gMouseBall: Nullable<Mesh> = undefined;
let gDetailBall: Nullable<Mesh> = undefined;
let gInterBall: Nullable<Mesh> = undefined;
let gLastCameraDistance = 0;
let gPolylinePoints: XYZ[] = [];
let gView: Nullable<ThreeView> = undefined;
let gTerrainSource: Nullable<Source> = undefined;
let gFolderDist: Nullable<FolderApi> = null;
let gFolderSample: Nullable<FolderApi> = null;
let gFolderMostDetailed: Nullable<FolderApi> = null;
let gFolderHeightEvent: Nullable<FolderApi> = null;
let gFujiUnregister: Nullable<() => void> = null;
let gKitaUnregister: Nullable<() => void> = null;
let gPickedFeature: Nullable<PickedFeature> = null;
let gPickedPos: Nullable<Vector3> = null;

const gPopup = new FloatingDialog();

export type CustomDescriptions = DefaultDescriptions;

type TerrainMode = "quantizedMesh" | "raster";

export const run = async (
  view: ThreeView<CustomDescriptions>,
  canvas: HTMLCanvasElement,
) => {
  const plugin = new DefaultPlugin();
  view.addPlugin(plugin);

  const attribution = view.attribution;

  await view.init();

  plugin.addDefaultPhotorealScene();

  gView = view;

  // Both terrain sources are registered up front and kept for the page's
  // lifetime; switching only re-points the terrain layer at the other source
  // (see the terrain-mvt example). `gTerrainSource` tracks the active one so
  // the sampleTerrainMostDetailed demos sample whatever terrain is rendered.
  const qmSource = view.addSource({
    type: "quantized-mesh",
    url: TERRAIN_DATASETS.reearthQuantizedMesh.url,
    maxZoom: 18,
    requestVertexNormals: true,
  });
  const demSource = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
    maxZoom: 15,
    minZoom: 5,
  });

  gTerrainSource = demSource;
  const terrainLayer = view.addLayer({
    type: "terrain",
    source: demSource,
  });
  // The hillshade only exists in raster-DEM mode; it is added/removed on
  // switch (its DEM source stays registered).
  let hillshadeLayer: Nullable<Layer> = view.addLayer({
    type: "raster",
    source: demSource,
    hillshade: {},
  });

  const addAttributions = (mode: TerrainMode) => {
    attribution?.clear();
    attribution?.add([
      mode === "quantizedMesh"
        ? TERRAIN_DATASETS.reearthQuantizedMesh
        : TERRAIN_DATASETS.gsi,
      TILE_DATASETS.openstreetmap,
      TILES_3D_DATASETS.plateauChiyoda,
      LOCAL_DATASETS.steelDrumGLTF,
    ]);
  };

  let currentTerrainMode: TerrainMode = "raster";
  const switchTerrainMode = (mode: TerrainMode) => {
    if (mode === currentTerrainMode) {
      return;
    }
    currentTerrainMode = mode;

    if (mode === "quantizedMesh") {
      gTerrainSource = qmSource;
      terrainLayer.update({ type: "terrain", source: qmSource });
      hillshadeLayer?.delete();
      hillshadeLayer = undefined;
    } else {
      gTerrainSource = demSource;
      terrainLayer.update({ type: "terrain", source: demSource });
      hillshadeLayer ??= view.addLayer({
        type: "raster",
        source: demSource,
        hillshade: {},
      });
    }
    addAttributions(mode);
    // The two sources disagree on heights (the quantized-mesh terrain is
    // ellipsoidal, GSI DEM is above sea level) — re-sample the Fuji summit
    // from the newly active source and re-place the model.
    sampleFujiSummitHeight(view);
  };

  view.on("pointerdown", (event: MapPointerEvent) => {
    console.log("3D Position:", event.map);
    console.log("Screen Position:", event.clientX, event.clientY);
  });

  const osmSource = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
  });
  view.addLayer({
    type: "raster",
    source: osmSource,
  });

  const plateauChiyodaSource = view.addSource({
    type: "3d-tiles",
    url: TILES_3D_DATASETS.plateauChiyoda.url,
  });
  view.addLayer({
    type: "3d-tiles",
    source: plateauChiyodaSource,
    model: {
      show: true,
      color: new Color().setStyle("#ffffff"),
      metalness: 0,
      roughness: 1,
    },
  });

  view.addMesh({
    axesHelper: {
      size: 5,
    },
    scale: new Vector3().setScalar(1e9),
  });

  const pane = new Pane({
    title: "Parameters",
    expanded: true,
  });

  addCameraControl(view, pane);

  addDateControl(view, pane);

  // Create polyline between two points on elipsoid surface
  createPolylineMesh(view);

  // adjust the polyline width based on camera distance
  addCameraListener(view);

  // initialize the control panel
  addCtrlPanel(pane);

  // terrain source switcher (quantized-mesh <-> raster DEM)
  addTerrainControl(pane, () => currentTerrainMode, switchTerrainMode);

  // create a ball running on the surface
  addRunningObject(view);

  // add a ball following mouse position
  testScreenToWorld(view, canvas);

  // extrude a cylinder from the elipsoid surface
  testRayPlane(view, canvas);

  // sample terrain height at mouse position
  testSampleTerrainHeight(view);

  // place a ball at the network-sampled max-LOD terrain height
  testSampleTerrainMostDetailed(view, canvas);

  // handle pick event and pop up information
  testShowModelInfo(view);

  // add a model for testing surface normal
  addTestModelForNormal(view);

  // add a model for testing terrain height
  addTestModelForTerrainHeight(view);

  gMouseBall = placeOneBall(view, new Vector3(0, 0, 0), 0x00ff00);
  gDetailBall = placeOneBall(view, new Vector3(0, 0, 0), 0xff00ff);
  gInterBall = placeOneBall(view, new Vector3(0, 0, 0), 0xff0000);
  onDistPosChange();
  onRegisterChange();

  addAttributions(currentTerrainMode);
};

const addTerrainControl = (
  pane: Pane,
  getMode: () => TerrainMode,
  switchMode: (mode: TerrainMode) => void,
) => {
  const params = { terrain: getMode() };
  const folder = pane.addFolder({ title: "Terrain", expanded: true });
  folder
    .addBinding(params, "terrain", {
      label: "type",
      options: [
        { text: "Quantized Mesh", value: "quantizedMesh" },
        { text: "DEM (Raster)", value: "raster" },
      ],
    })
    .on("change", (ev) => {
      switchMode(ev.value as TerrainMode);
    });
};

const addRunningObject = (view: ThreeView<CustomDescriptions>) => {
  const sphere = placeOneBall(view, new Vector3(0, 0, 0), 0xffffff);
  if (!sphere) {
    return;
  }

  sphere.scale.set(300000, 300000, 300000);

  let lng = 0.0;
  let lat = 0.0;
  let latStep = 0.01;
  const lngStep = 1;

  const animateFunc = () => {
    lng += lngStep;
    lat += latStep;
    if (lng > 360.0) lng -= 360.0;
    if (lat > 90.0) {
      latStep = -latStep;
    }

    const pos = geodeticToVector3({
      lat,
      lng,
      height: 1000000,
    });
    sphere.position.set(pos.x, pos.y, pos.z);

    view.forceUpdate();
    requestAnimationFrame(animateFunc);
  };
  animateFunc();
};

const testScreenToWorld = (
  view: ThreeView<CustomDescriptions>,
  canvas: HTMLCanvasElement,
) => {
  const onPointerMove = (event: PointerEvent) => {
    if (!gPaneParams.convertScreenToWorld) {
      return;
    }

    const pos = view.pickTerrainPosition(event.clientX, event.clientY);

    if (gMouseBall && pos) {
      gMouseBall.position.set(pos.x, pos.y, pos.z);
      view.forceUpdate();
    }
  };

  canvas.addEventListener("pointermove", onPointerMove);
};

const placeOneBall = (
  view: ThreeView<CustomDescriptions>,
  pos: Vector3 | undefined,
  color: number,
): Mesh | undefined => {
  if (pos) {
    const sphereLayer = view.addMesh<SphereMeshDesc>({
      sphere: {
        radius: 1,
        color: new Color().setHex(color),
        emissiveColor: new Color().setHex(0x072534),
      },
      position: { x: pos.x, y: pos.y, z: pos.z },
    });

    // sphereLayer is a MeshHandle for mesh descriptors
    return sphereLayer.ref.raw;
  }
};

const addTestModelForNormal = (view: ThreeView<CustomDescriptions>) => {
  const pos = geodeticToVector3({
    lat: 43.0618,
    lng: 141.3545,
    height: 0,
  });
  const normal = geodeticSurfaceNormal({
    lat: 43.0618,
    lng: 141.3545,
    height: 0,
  });

  // Add GLTF model using GLTFModelDesc with URL
  const modelLayer = view.addMesh<GLTFModelDesc>({
    gltfModel: {
      url: LOCAL_DATASETS.steelDrumGLTF.url,
    },
    scale: { x: 200000, y: 200000, z: 200000 },
    position: { x: pos.x, y: pos.y, z: pos.z },
  });

  // Add arrow helper
  view.addMesh({
    arrowHelper: {
      direction: normal,
      origin: pos,
      length: 5000000,
      color: new Color().setStyle("#ffffff"),
      headLength: 400000,
      headWidth: 70000,
    },
  });

  // Store reference to the model layer handle
  gModelNormalHandle = modelLayer;
  if (gModelNormalHandle.ref && gModelNormalHandle.ref.raw) {
    gModelNormalHandle.ref.raw.userData.origin = pos;
    gModelNormalHandle.ref.raw.userData.normal = normal;

    // Add axes when model loads
    gModelNormalHandle.ref.on("load", () => {
      if (
        gModelNormalHandle?.ref?.raw &&
        gModelNormalHandle.ref.raw.children.length > 0
      ) {
        addAxisToModel(gModelNormalHandle.ref.raw.children[0] as Group);
        onTransformChange();
      }
    });
  }
};

// (Re)place the Fuji model on the surface at the current
// `gPaneParams.fujiHeight`. Shared by the accurate sampleTerrainMostDetailed
// placement and the terrain-height observer. The placement goes through the
// desc's `matrixWorld` (the supported geographic-placement path): the desc
// decomposes it into RTE position uniforms + rotation/scale, so mutating
// `raw` directly would fight that machinery and lose the model.
const placeFujiModel = () => {
  const pos = geodeticToVector3({
    lat: gFujiPos[0],
    lng: gFujiPos[1],
    height: gPaneParams.fujiHeight,
  });
  gModelFujiHandle?.update({ matrixWorld: northUpEastToFixedFrame(pos) });
};

const addTestModelForTerrainHeight = (view: ThreeView<CustomDescriptions>) => {
  const pos = geodeticToVector3({
    lat: gFujiPos[0],
    lng: gFujiPos[1],
    height: 0,
  });

  // Place via a tangent-frame matrixWorld; local scale applies within it.
  const modelLayer = view.addMesh<GLTFModelDesc>({
    gltfModel: {
      url: LOCAL_DATASETS.steelDrumGLTF.url,
    },
    scale: new Vector3().setScalar(200),
    matrixWorld: northUpEastToFixedFrame(pos),
  });

  // Store reference to the model layer handle
  gModelFujiHandle = modelLayer;

  gModelFujiHandle.ref.on("load", () => {
    if (
      gModelFujiHandle?.ref?.raw &&
      gModelFujiHandle.ref.raw.children.length > 0
    ) {
      addAxisToModel(gModelFujiHandle.ref.raw.children[0] as Group);
    }
  });

  // The synchronous terrain-height paths know nothing until tiles near Fuji
  // stream in, which never happens while the camera is elsewhere — the model
  // would sit at height 0, buried inside the mountain. Fetch the accurate
  // summit height over the network and lift the model onto it.
  sampleFujiSummitHeight(view);
};

// Sample the Fuji summit height from the active terrain source and place the
// model on it. Also re-run on terrain-source switches: the sources disagree
// on heights, so the model must follow the rendered surface.
const sampleFujiSummitHeight = (view: ThreeView<CustomDescriptions>) => {
  if (!gTerrainSource) {
    return;
  }
  view
    .sampleTerrainMostDetailed(gTerrainSource, [
      { lat: gFujiPos[0], lng: gFujiPos[1] },
    ])
    .then(([ground]) => {
      if (ground.height !== undefined) {
        gPaneParams.fujiHeight = ground.height;
        gFolderHeightEvent?.refresh();
        placeFujiModel();
        view.forceUpdate();
      }
    })
    .catch((e) => {
      console.warn("failed to sample the Mt. Fuji summit height:", e);
    });
};

const addAxisToModel = (model: Object3D) => {
  const xAxis = new ArrowHelper(
    new Vector3(1, 0, 0),
    new Vector3(0, 0, 0),
    5,
    0xff0000,
  );
  const yAxis = new ArrowHelper(
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 0),
    5,
    0x00ff00,
  );
  const zAxis = new ArrowHelper(
    new Vector3(0, 0, 1),
    new Vector3(0, 0, 0),
    5,
    0x0000ff,
  );
  model.add(xAxis);
  model.add(yAxis);
  model.add(zAxis);
};

const addCtrlPanel = (pane: Pane) => {
  pane.addBinding(gPaneParams, "convertScreenToWorld");
  pane.addBinding(gPaneParams, "sampleMostDetailed");
  pane.addBinding(gPaneParams, "extrudeCylinder");

  const fNormal = pane.addFolder({
    title: "SurfaceNormal",
    expanded: false,
  });

  fNormal
    .addBinding(gPaneParams, "moveDistance", { min: 0.0, max: 4000000.0 })
    .on("change", onMoveDistanceChange);

  const fTransform = pane.addFolder({
    title: "Transform",
    expanded: false,
  });

  fTransform
    .addBinding(gPaneParams, "transform", {
      options: {
        eastNorthUp: "eastNorthUp",
        northEastDown: "northEastDown",
        northUpEast: "northUpEast",
        northWestUp: "northWestUp",
      },
    })
    .on("change", onTransformChange);

  gFolderDist = pane.addFolder({
    title: "Distance",
    expanded: false,
  });

  gFolderDist
    .addBinding(gPaneParams, "lngStart", { min: -180.0, max: 180.0 })
    .on("change", onDistPosChange);
  gFolderDist
    .addBinding(gPaneParams, "latStart", { min: -90.0, max: 90.0 })
    .on("change", onDistPosChange);
  gFolderDist
    .addBinding(gPaneParams, "lngEnd", { min: -180.0, max: 180.0 })
    .on("change", onDistPosChange);
  gFolderDist
    .addBinding(gPaneParams, "latEnd", { min: -90.0, max: 90.0 })
    .on("change", onDistPosChange);
  gFolderDist.addBinding(gPaneParams, "distance");
  gFolderDist
    .addBinding(gPaneParams, "interpolate", {
      min: 0.0,
      max: 1.0,
      step: 0.001,
    })
    .on("change", onDistPosChange);

  gFolderSample = pane.addFolder({
    title: "SampleTerrainHeight",
    expanded: false,
  });
  gFolderSample.addBinding(gPaneParams, "sampleLng", { label: "Longitude" });
  gFolderSample.addBinding(gPaneParams, "sampleLat", { label: "Latitude" });
  gFolderSample.addBinding(gPaneParams, "sampleTerrainHeight", {
    label: "Height",
  });

  gFolderMostDetailed = pane.addFolder({
    title: "SampleTerrainMostDetailed",
    expanded: false,
  });
  gFolderMostDetailed.addBinding(gPaneParams, "mostDetailedHeight", {
    label: "Height",
  });
  gFolderMostDetailed.addBinding(gPaneParams, "mostDetailedLevel", {
    label: "Level",
  });

  gFolderHeightEvent = pane.addFolder({
    title: "TerrainHeightEvent",
    expanded: false,
  });
  gFolderHeightEvent.addBinding(gPaneParams, "fujiHeight", { label: "富士山" });
  gFolderHeightEvent
    .addBinding(gPaneParams, "fujiRegistered", { label: "register" })
    .on("change", onRegisterChange);
  gFolderHeightEvent.addBlade({ view: "separator" });
  gFolderHeightEvent.addBinding(gPaneParams, "kitaHeight", { label: "北岳" });
  gFolderHeightEvent
    .addBinding(gPaneParams, "kitaRegistered", { label: "register" })
    .on("change", onRegisterChange);

  const fFrustum = pane.addFolder({
    title: "Frustum",
    expanded: true,
  });
  fFrustum.addBinding(gPaneParams, "fov").on("change", onFovChange);
  fFrustum.addBinding(gPaneParams, "near").on("change", onNearChange);
  fFrustum.addBinding(gPaneParams, "far").on("change", onFarChange);
};

const onMoveDistanceChange = () => {
  if (
    gModelNormalHandle?.ref?.raw &&
    gModelNormalHandle.ref.raw.userData.normal &&
    gModelNormalHandle.ref.raw.userData.origin
  ) {
    const normal = gModelNormalHandle.ref.raw.userData.normal;
    const pos = gModelNormalHandle.ref.raw.userData.origin;

    // Move the model along the surface normal
    const newPos = new Vector3(
      pos.x + normal.x * gPaneParams.moveDistance,
      pos.y + normal.y * gPaneParams.moveDistance,
      pos.z + normal.z * gPaneParams.moveDistance,
    );

    // Use update() method instead of direct manipulation
    gModelNormalHandle.update({ position: newPos });
  }
};

const onTransformChange = () => {
  if (
    !gModelNormalHandle?.ref?.raw ||
    !gModelNormalHandle.ref.raw.userData.origin
  ) {
    return;
  }

  // Reset position, rotation, and scale using update()
  gModelNormalHandle.update({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 200000, y: 200000, z: 200000 },
  });

  let transformMatrix;
  switch (gPaneParams.transform) {
    case "eastNorthUp":
      transformMatrix = eastNorthUpToFixedFrame(
        gModelNormalHandle.ref.raw.userData.origin,
      );
      break;
    case "northEastDown":
      transformMatrix = northEastDownToFixedFrame(
        gModelNormalHandle.ref.raw.userData.origin,
      );
      break;
    case "northUpEast":
      transformMatrix = northUpEastToFixedFrame(
        gModelNormalHandle.ref.raw.userData.origin,
      );
      break;
    case "northWestUp":
      transformMatrix = northWestUpToFixedFrame(
        gModelNormalHandle.ref.raw.userData.origin,
      );
      break;
    default:
      transformMatrix = eastNorthUpToFixedFrame(
        gModelNormalHandle.ref.raw.userData.origin,
      );
  }

  gModelNormalHandle.ref.raw.applyMatrix4(transformMatrix);

  if (gModelNormalHandle.ref.raw.userData.normal) {
    const moveOffset = gModelNormalHandle.ref.raw.userData.normal
      .clone()
      .multiplyScalar(gPaneParams.moveDistance);
    // Get current position and add offset
    const currentPos = gModelNormalHandle.ref.getWorldPosition();
    currentPos.add(moveOffset);
    gModelNormalHandle.update({ position: currentPos });
  }
};

const testRayPlane = (
  view: ThreeView<CustomDescriptions>,
  canvas: HTMLCanvasElement,
) => {
  let center: Vector3 | undefined = undefined;
  let radius: number | undefined = undefined;
  let height: number | undefined = undefined;
  let normal: Vector3 | undefined = undefined;
  let btmDist: number | undefined = undefined;
  let cylinder: Mesh | undefined = undefined;
  let bMouseMoved = false;

  const onPointerDown = (_e: MapPointerEvent) => {
    bMouseMoved = false;
  };
  const onPointerMove = (event: MapPointerEvent) => {
    bMouseMoved = true;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const screenSize = view.screenSize;
    const pixelRatio = view.pixelRatio;

    if (center && normal && !radius) {
      const win: Window = {
        width: screenSize.x,
        height: screenSize.y,
        pixelRatio: pixelRatio,
      };
      const ray = getPickRay(win, view.camera.raw, new Vector2(x, y));

      const btmPlane = getPlaneFromPointNormal(center, normal);
      const intersectPt = getRayPlaneIntersection(ray, btmPlane);
      if (intersectPt) {
        btmDist = intersectPt.distanceTo(center);
        if (cylinder) {
          cylinder.scale.set(btmDist, 1, btmDist);
        }
      }
      return;
    }

    if (center && normal && radius) {
      const win: Window = {
        width: screenSize.x,
        height: screenSize.y,
        pixelRatio: pixelRatio,
      };
      const ray = getPickRay(win, view.camera.raw, new Vector2(x, y));
      const rayDir = ray.direction.clone();
      const planeNormal = rayDir.cross(normal).cross(normal).normalize();
      const plane = getPlaneFromPointNormal(center, planeNormal);
      const intersectPt = getRayPlaneIntersection(ray, plane);
      if (intersectPt) {
        height = getHeightFromEllipsoid(intersectPt);
        if (cylinder) {
          cylinder.scale.set(radius, Math.max(1, height), radius);
        }
      }
    }
  };
  const onPointerUp = (event: MapPointerEvent) => {
    if (bMouseMoved || !gPaneParams.extrudeCylinder) {
      return;
    }

    const mapPos = event.map;
    const pos = mapPos ? new Vector3(mapPos.x, mapPos.y, mapPos.z) : null;

    if (!center && pos) {
      center = pos;

      const lle = vector3ToGeodetic(pos);
      normal = geodeticSurfaceNormal(lle);

      cylinder = makeCylinder(view, center);
      return;
    }

    if (!radius && btmDist && pos) {
      radius = btmDist;
      return;
    }

    center = undefined;
    radius = undefined;
    normal = undefined;
    cylinder = undefined;
  };

  view.on("pointerdown", onPointerDown);
  view.on("pointermove", onPointerMove);
  view.on("pointerup", onPointerUp);
};

const makeCylinder = (
  view: ThreeView<CustomDescriptions>,
  center: Vector3,
): Mesh | undefined => {
  const cylinderLayer = view.addMesh<CylinderMeshDesc>({
    cylinder: {
      radiusTop: 1,
      radiusBottom: 1,
      height: 1,
      radialSegments: 32,
      heightSegments: 1,
      openEnded: false,
      thetaStart: 0,
      thetaLength: Math.PI * 2,
      color: new Color().setStyle("#ffff00"),
    },
  });

  const cylinder = cylinderLayer.ref.raw;

  if (cylinder) {
    // Translate the cylinder so its base is at the origin
    cylinder.geometry.translate(0, 0.5, 0);

    const transformMatrix = northUpEastToFixedFrame(center);
    cylinder.applyMatrix4(transformMatrix);
  }

  return cylinder;
};

const onDistPosChange = () => {
  const start = {
    lat: gPaneParams.latStart,
    lng: gPaneParams.lngStart,
    height: 0,
  };
  const end = {
    lat: gPaneParams.latEnd,
    lng: gPaneParams.lngEnd,
    height: 0,
  };

  const geodesic = new EllipsoidGeodesic(start, end);
  gPaneParams.distance = geodesic.distance;

  gFolderDist?.refresh();

  const points = geodesic.interpolatePoints(gPaneParams.distance * 0.01);

  // Update polyline mesh
  if (gPolylineLayer) {
    const curvePoints: XYZ[] = [];
    for (const point of points) {
      const pos = geodeticToVector3({
        lat: point.lat,
        lng: point.lng,
        height: 1000,
      });
      curvePoints.push(pos);
    }

    // Store points and update geometry
    if (curvePoints.length >= 2 && gView) {
      gPolylinePoints = curvePoints;
      requestAnimationFrame(() => {
        if (!gView) return;
        updatePolylineMesh(gView, curvePoints);
      });

      // update interpolated point
      const interDist = gPaneParams.distance * gPaneParams.interpolate;
      const interPoint = geodesic.interpolateDistance(interDist);
      const pos = geodeticToVector3({
        lat: interPoint.lat,
        lng: interPoint.lng,
        height: 1000,
      });
      gInterBall?.position.set(pos.x, pos.y, pos.z);
    }
  }

  geodesic.dispose();
};

const updatePolylineMesh = (
  view: ThreeView<CustomDescriptions>,
  curvePoints: XYZ[],
) => {
  if (!gPolylineLayer) return;

  // Calculate appropriate tube radius based on camera distance to keep visual thickness constant
  const centerPoint = new Vector3(0, 0, 0);
  const polarRadius = 6356752;

  // The calculation used to estimate the distance from the camera to the ground surface.
  const cameraDistance =
    view.camera.raw.position.distanceTo(centerPoint) - polarRadius;

  // Store current distance for camera change detection
  gLastCameraDistance = cameraDistance;

  const visualThickness = 0.002; // How thick the line appears on screen
  const finalRadius = cameraDistance * visualThickness;

  // Set reasonable bounds to prevent extremely thin or thick tubes
  const minRadius = 10;
  const maxRadius = 100000;
  const clampedRadius = Math.max(minRadius, Math.min(maxRadius, finalRadius));

  // Use more segments for smoother geometry
  const tubularSegments = Math.max(64, curvePoints.length * 4); // More segments along the curve
  const radialSegments = 16; // More radial segments for rounder cross-section

  // Update the tube layer using layer.update()
  gPolylineLayer.update({
    tube: {
      points: curvePoints,
      tubularSegments: tubularSegments,
      radius: clampedRadius,
      radialSegments: radialSegments,
      tension: 0.5,
    },
  });

  const intBallRadius = clampedRadius * 2;
  gInterBall?.scale.set(intBallRadius, intBallRadius, intBallRadius);

  const mouseBallRadius = clampedRadius * 3;
  gMouseBall?.scale.set(mouseBallRadius, mouseBallRadius, mouseBallRadius);
};

const addCameraListener = (view: ThreeView<CustomDescriptions>) => {
  // Update tube thickness when camera moves
  view.camera.on("move", () => {
    if (!gPolylineLayer || !view.camera || gPolylinePoints.length === 0) return;

    const centerPoint = gPolylinePoints[Math.floor(gPolylinePoints.length / 2)];
    const currentDistance = view.camera.raw.position.distanceTo(centerPoint);

    // Only update if camera distance changed significantly (more than 10%)
    if (gLastCameraDistance > 0) {
      const distanceChange =
        Math.abs(currentDistance - gLastCameraDistance) / gLastCameraDistance;
      if (distanceChange > 0.1) {
        updatePolylineMesh(view, gPolylinePoints);
      }
    }

    updatePopup();
  });
};

const createPolylineMesh = (view: ThreeView<CustomDescriptions>) => {
  // Create initial points for the curve
  const points: XYZ[] = Array.from({ length: 2 }, () => ({
    x: 0,
    y: 0,
    z: 0,
  }));

  gPolylineLayer = view.addMesh<TubeMeshDesc>({
    tube: {
      points,
      tubularSegments: 64,
      radius: 1,
      radialSegments: 16,
      closed: false,
      tension: 0.5,
      color: new Color().setStyle("#00ffff"),
    },
  });
};

const testSampleTerrainHeight = (view: ThreeView<CustomDescriptions>) => {
  const onPointerMove = (event: MapPointerEvent) => {
    const mapPos = event.map;

    if (mapPos) {
      const pos = new Vector3(mapPos.x, mapPos.y, mapPos.z);
      const lle = vector3ToGeodetic(pos);

      const height = view.sampleTerrainHeight(lle);

      gPaneParams.sampleLng = lle.lng;
      gPaneParams.sampleLat = lle.lat;
      gPaneParams.sampleTerrainHeight = height ?? 0;
      gFolderSample?.refresh();
    }
  };

  view.on("pointermove", onPointerMove);
};

// Like testScreenToWorld, but the ball sits on the network-sampled max-LOD
// terrain height instead of the depth buffer: the depth buffer only knows the
// coarse tiles currently rendered, while sampleTerrainMostDetailed fetches
// the source's most detailed tile for the position. Requests are coalesced —
// one in flight at a time, always sampling the newest mouse position.
const testSampleTerrainMostDetailed = (
  view: ThreeView<CustomDescriptions>,
  canvas: HTMLCanvasElement,
) => {
  let latest: { lat: number; lng: number; screen: Vector2 } | undefined;
  let inFlight = false;

  const sampleLatest = async () => {
    if (inFlight || !latest) {
      return;
    }
    const target = latest;
    latest = undefined;
    inFlight = true;
    try {
      // The mouse ray hit the *rendered* (possibly coarse) surface, so a ball
      // raised to the sampled height at that lat/lng would drift off the
      // cursor on screen. Keep the center on the cursor: slide the point
      // along the pick ray onto the local tangent plane at the sampled
      // height, then resample at the slid position once to converge.
      const win: Window = {
        width: view.screenSize.x,
        height: view.screenSize.y,
        pixelRatio: view.pixelRatio,
      };
      const ray = getPickRay(win, view.camera.raw, target.screen);

      let { lat, lng } = target;
      let ballPos: Nullable<Vector3> = undefined;
      let height = 0;
      let level = 0;
      for (let i = 0; i < 2; i++) {
        if (!gTerrainSource) {
          return;
        }
        const [ground] = await view.sampleTerrainMostDetailed(gTerrainSource, [
          { lat, lng },
        ]);
        if (ground.height === undefined) {
          return;
        }
        height = ground.height;
        level = ground.level ?? 0;

        const surface = geodeticToVector3({ lat, lng, height });
        const plane = getPlaneFromPointNormal(
          surface,
          geodeticSurfaceNormal({ lat, lng, height }),
        );
        const onRay = getRayPlaneIntersection(ray, plane);
        if (!onRay) {
          ballPos = surface;
          break;
        }
        ballPos = onRay;
        const slid = vector3ToGeodetic(onRay);
        lat = slid.lat;
        lng = slid.lng;
      }

      if (ballPos && gDetailBall) {
        gDetailBall.position.set(ballPos.x, ballPos.y, ballPos.z);
        // Keep the ball a constant on-screen size (~1% of the view distance
        // as radius); the unit sphere is sub-pixel from any real altitude.
        const ballRadius = Math.max(
          view.camera.raw.position.distanceTo(ballPos) / 100,
          0.5,
        );
        gDetailBall.scale.set(ballRadius, ballRadius, ballRadius);
        gPaneParams.mostDetailedHeight = height;
        gPaneParams.mostDetailedLevel = level;
        gFolderMostDetailed?.refresh();
        view.forceUpdate();
      }
    } catch (e) {
      console.warn("sampleTerrainMostDetailed failed:", e);
    } finally {
      inFlight = false;
      void sampleLatest();
    }
  };

  view.on("pointermove", (event: MapPointerEvent) => {
    if (!gPaneParams.sampleMostDetailed || !event.map) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const lle = vector3ToGeodetic(
      new Vector3(event.map.x, event.map.y, event.map.z),
    );
    latest = {
      lat: lle.lat,
      lng: lle.lng,
      screen: new Vector2(event.clientX - rect.left, event.clientY - rect.top),
    };
    void sampleLatest();
  });
};

const onRegisterChange = () => {
  if (gFujiUnregister) {
    gFujiUnregister();
    gFujiUnregister = null;
  }
  if (gKitaUnregister) {
    gKitaUnregister();
    gKitaUnregister = null;
  }

  if (gPaneParams.fujiRegistered) {
    gFujiUnregister = gView?.observeTerrainHeightAt(
      { lat: gFujiPos[0], lng: gFujiPos[1] },
      (height) => {
        gPaneParams.fujiHeight = height ?? 0;
        gFolderHeightEvent?.refresh();
        placeFujiModel();
      },
    );
  }

  if (gPaneParams.kitaRegistered) {
    gKitaUnregister = gView?.observeTerrainHeightAt(
      { lat: gKitaPos[0], lng: gKitaPos[1] },
      (height) => {
        gPaneParams.kitaHeight = height ?? 0;
        gFolderHeightEvent?.refresh();
      },
    );
  }
};

const testShowModelInfo = (view: ThreeView<CustomDescriptions>) => {
  view.on("featureClick", (info) => {
    if (!info) {
      gPickedPos = null;
      gPickedFeature = null;
      updatePopup();
      return;
    }

    const x = info.properties?.["_x"];
    const y = info.properties?.["_y"];
    const z = info.properties?.["_zmax"];

    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number"
    ) {
      gPickedPos = null;
      gPickedFeature = null;
      updatePopup();
      return;
    }

    gPickedPos = geodeticToVector3({
      lat: y,
      lng: x,
      height: z,
    });

    gPickedFeature = info;

    updatePopup();
  });
};

const updatePopup = () => {
  if (gView && gPickedFeature && gPickedPos) {
    const screenSize = gView.screenSize;
    const pixelRatio = gView.pixelRatio;

    const win: Window = {
      width: screenSize.x,
      height: screenSize.y,
      pixelRatio: pixelRatio,
    };
    const screenPos = convertWorldToScreen(win, gView.camera.raw, gPickedPos);

    if (screenPos) {
      gPopup.updateMessages([
        `name: ${gPickedFeature.properties?.["gml:name"] ?? "N/A"}`,
        `address: ${gPickedFeature.properties?.["bldg:address"] ?? "N/A"}`,
        `class: ${gPickedFeature.properties?.["bldg:class"] ?? "N/A"}`,
        `usage: ${gPickedFeature.properties?.["bldg:usage"] ?? "N/A"}`,
      ]);
      gPopup.updatePosition(screenPos.x, screenPos.y);
      gPopup.show();
    } else {
      gPopup.hide();
    }
  } else {
    gPopup.hide();
  }
};

const onFovChange = () => {
  if (gView && gView.camera) {
    gView.camera.fov = gPaneParams.fov;
  }
};

const onNearChange = () => {
  if (gView && gView.camera) {
    gView.camera.near = gPaneParams.near;
  }
};

const onFarChange = () => {
  if (gView && gView.camera) {
    gView.camera.far = gPaneParams.far;
  }
};
