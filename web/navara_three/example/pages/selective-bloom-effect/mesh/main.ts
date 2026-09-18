import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
  geodeticToVector3,
} from "@navaramap/three";
import type {
  BoxMeshDesc,
  SphereMeshDesc,
  CylinderMeshDesc,
  PlaneMeshDesc,
  TubeMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Vector3 } from "three";

import { TERRAIN_DATASETS, TILE_DATASETS } from "../../../helpers/constants";
import { atZoneTime } from "../../../helpers/control";

const run = async () => {
  const view = new ThreeView<DefaultDescriptions>({
    debug: true,
    shadow: true,
  });

  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const attribution = view.attribution;

  await view.init();

  const defaultAtmospheres = defaultPlugin.addDefaultPhotorealScene();
  defaultAtmospheres.sun.update({
    sun: { intensity: 1, castShadow: true },
  });

  view.atmosphere.date = atZoneTime(view.atmosphere.date, 8);

  view.setCamera({
    lng: 139.767125,
    lat: 35.676,
    height: 800,
    heading: 0,
    pitch: -45,
    roll: 0,
  });

  // Selective bloom effect
  const bloomEffect = view.addEffect({
    selectiveBloom: {
      strength: 1.0,
      radius: 0.5,
      threshold: 0.0,
    },
  });

  // Mesh descriptors with bloom
  const tokyoStationPosition = geodeticToVector3({
    lat: 35.681236,
    lng: 139.767125,
    height: 200,
  });

  view.addMesh<BoxMeshDesc>({
    box: {
      width: 200,
      height: 200,
      depth: 200,
      color: new Color().setHex(0xff0000),
      emissiveColor: new Color().setHex(0xff0000),
      emissiveIntensity: 1.0,
      castShadow: true,
      receiveShadow: true,
      effectIds: [bloomEffect.id],
    },
    position: {
      x: tokyoStationPosition.x,
      y: tokyoStationPosition.y,
      z: tokyoStationPosition.z,
    },
  });

  const spherePosition = tokyoStationPosition
    .clone()
    .add(new Vector3(-500, 0, -600));

  view.addMesh<SphereMeshDesc>({
    sphere: {
      radius: 100,
      color: new Color().setHex(0x00aaff),
      emissiveColor: new Color().setHex(0x0000ff),
      emissiveIntensity: 1.0,
      castShadow: true,
      receiveShadow: true,
      effectIds: [bloomEffect.id],
    },
    position: {
      x: spherePosition.x,
      y: spherePosition.y,
      z: spherePosition.z,
    },
  });

  // Cylinder
  const cylinderPosition = geodeticToVector3({
    lat: 35.681236,
    lng: 139.773,
    height: 400,
  });

  view.addMesh<CylinderMeshDesc>({
    cylinder: {
      radiusTop: 50,
      radiusBottom: 80,
      height: 300,
      color: new Color().setHex(0x00ff88),
      emissiveColor: new Color().setHex(0x00ff88),
      emissiveIntensity: 1.0,
      castShadow: true,
      receiveShadow: true,
      effectIds: [bloomEffect.id],
    },
    position: {
      x: cylinderPosition.x,
      y: cylinderPosition.y,
      z: cylinderPosition.z,
    },
  });

  // Plane
  const planePosition = geodeticToVector3({
    lat: 35.678,
    lng: 139.767125,
    height: 400,
  });

  view.addMesh<PlaneMeshDesc>({
    plane: {
      width: 200,
      height: 200,
      color: new Color().setHex(0xffaa00),
      emissiveColor: new Color().setHex(0xffaa00),
      emissiveIntensity: 1.0,
      castShadow: true,
      receiveShadow: true,
      effectIds: [bloomEffect.id],
    },
    position: {
      x: planePosition.x,
      y: planePosition.y,
      z: planePosition.z,
    },
  });

  // Tube
  const tubeBasePosition = geodeticToVector3({
    lat: 35.678,
    lng: 139.773,
    height: 400,
  });

  view.addMesh<TubeMeshDesc>({
    tube: {
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 100, y: 200, z: 0 },
        { x: 300, y: 100, z: 0 },
        { x: 400, y: 300, z: 0 },
      ],
      radius: 20,
      tubularSegments: 64,
      radialSegments: 8,
      color: new Color().setHex(0xff00ff),
      emissiveColor: new Color().setHex(0xff00ff),
      emissiveIntensity: 1.0,
      effectIds: [bloomEffect.id],
    },
    position: {
      x: tubeBasePosition.x,
      y: tubeBasePosition.y,
      z: tubeBasePosition.z,
    },
  });

  // Base layers
  const terrainDem = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    maxZoom: 15,
    minZoom: 5,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  });
  view.addLayer({
    type: "terrain",
    source: terrainDem,
    terrain: {
      castShadow: true,
      receiveShadow: true,
    },
  });

  view.addLayer({
    type: "raster",
    source: terrainDem,
    hillshade: {},
  });

  const openstreetmap = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 23,
  });
  view.addLayer({
    type: "raster",
    source: openstreetmap,
  });

  attribution?.add([TILE_DATASETS.openstreetmap, TERRAIN_DATASETS.gsi]);
};

run();
