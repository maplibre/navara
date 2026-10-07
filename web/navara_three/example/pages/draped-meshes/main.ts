import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
  northUpEastToFixedFrame,
  geodeticToVector3,
} from "@navaramap/three";
import type {
  BoxMeshDesc,
  CylinderMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { TERRAIN_DATASETS, TILE_DATASETS } from "../../helpers/constants";
import { addDateControl } from "../../helpers/control";

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
    sun: { intensity: 2, castShadow: true, shadowFar: 5000 },
  });

  view.addLight({
    ambient: { intensity: 0.5 },
  });

  view.setCamera({
    lng: 138.7306518555,
    lat: 35.285277832,
    height: 15000,
    heading: 0,
    pitch: -60,
    roll: 0,
  });

  // Base layers
  const osmSource = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 18,
  });
  view.addLayer({
    type: "raster",
    source: osmSource,
  });

  const gsiTerrainDem = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
    maxZoom: 18,
  });
  view.addLayer({
    type: "terrain",
    source: gsiTerrainDem,
    terrain: {
      castShadow: true,
      receiveShadow: true,
    },
  });

  view.addLayer({
    type: "raster",
    source: gsiTerrainDem,
    hillshade: {},
  });

  // Positions & ENU matrices around Mt. Fuji
  const boxPosition = geodeticToVector3({
    lat: 35.365,
    lng: 138.735,
    height: 100,
  });
  const boxMatrixWorld = northUpEastToFixedFrame(boxPosition);

  // `draped` is fixed at creation, so toggling it re-adds the mesh.
  const addBox = (draped: boolean) =>
    view.addMesh<BoxMeshDesc>({
      box: {
        width: 1000,
        height: 10000,
        depth: 1000,
        color: new Color().setHex(0xff4444),
        castShadow: true,
        receiveShadow: true,
        draped,
      },
      matrixWorld: boxMatrixWorld,
    });

  const cylinderPosition = geodeticToVector3({
    lat: 35.355,
    lng: 138.72,
    height: 100,
  });
  const cylinderMatrixWorld = northUpEastToFixedFrame(cylinderPosition);

  const addCylinder = (draped: boolean) =>
    view.addMesh<CylinderMeshDesc>({
      cylinder: {
        radiusTop: 500,
        radiusBottom: 500,
        height: 10000,
        radialSegments: 32,
        color: new Color().setHex(0x4488ff),
        castShadow: true,
        receiveShadow: true,
        draped,
      },
      matrixWorld: cylinderMatrixWorld,
    });

  let boxLayer = addBox(true);
  let cylinderLayer = addCylinder(true);

  // Control panel
  const pane = new Pane({ title: "Draped Meshes" });
  addDateControl(view, pane);

  const boxParams = { draped: true };
  const cylinderParams = { draped: true };

  const boxFolder = pane.addFolder({ title: "Box" });
  boxFolder.addBinding(boxParams, "draped").on("change", ({ value }) => {
    boxLayer.delete();
    boxLayer = addBox(value);
  });

  const cylinderFolder = pane.addFolder({ title: "Cylinder" });
  cylinderFolder
    .addBinding(cylinderParams, "draped")
    .on("change", ({ value }) => {
      cylinderLayer.delete();
      cylinderLayer = addCylinder(value);
    });

  attribution?.add([TILE_DATASETS.openstreetmap, TERRAIN_DATASETS.gsi]);
};

run();
