import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
  geodeticToVector3,
  northUpEastToFixedFrame,
} from "@navaramap/three";
import {
  ToneMappingMode,
  type BoxChildConfig,
  type InstancedBoxMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { TERRAIN_DATASETS, TILE_DATASETS } from "../../../helpers/constants";

const RADIUS = 30000; // 30km
const BUILDING_COUNT = 10000;

/** Generate a random point within a circle of the given radius. */
function randomPointInCircle(radius: number): { x: number; z: number } {
  const angle = Math.random() * Math.PI * 2;
  const r = radius * Math.sqrt(Math.random());
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
}

/** Generate random building configs within a circle. */
function generateBuildings(count: number, radius: number): BoxChildConfig[] {
  const buildings: BoxChildConfig[] = [];
  for (let i = 0; i < count; i++) {
    const { x, z } = randomPointInCircle(radius);
    const base = 30 + Math.random() * 60;
    const height = 10 + Math.random() * 200;
    const dist = Math.sqrt(x * x + z * z);
    const centerFactor = 1 - dist / radius;
    const adjustedHeight = height * (1 + centerFactor * 3);

    buildings.push({
      width: base,
      height: adjustedHeight,
      depth: base,
      color: new Color().setStyle(
        `hsl(${Math.random() * 360}, ${50 + Math.random() * 50}%, ${30 + Math.random() * 50}%)`,
      ),
      position: { x, y: adjustedHeight / 2, z },
    });
  }
  return buildings;
}

const run = async () => {
  const view = new ThreeView<DefaultDescriptions>({
    debug: true,
    // Lit tiles: the exposure below is tuned for the ambient-lit (darker) basemap.
    useNormal: true,
  });

  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const attribution = view.attribution;

  await view.init();

  view.addLight({
    ambient: {
      intensity: 0.5,
    },
  });

  view.addEffect({
    toneMapping: {
      mode: ToneMappingMode.NEUTRAL,
    },
  });
  view.toneMappingExposure = 3;

  view.setCamera({
    lng: 139.6021321921,
    lat: 35.613845829,
    height: 9067.93,
    heading: 64.212584702,
    pitch: -36.0220732663,
    roll: 0.2,
  });

  // Selective bloom effect
  const bloomEffect = view.addEffect({
    selectiveBloom: {
      strength: 1.0,
      radius: 0.5,
      threshold: 0.0,
    },
  });

  // Position the group at Tokyo Station
  const groupPosition = geodeticToVector3({
    lat: 35.6812,
    lng: 139.7671,
    height: 0,
  });
  const matrixWorld = northUpEastToFixedFrame(groupPosition);

  const buildings = generateBuildings(BUILDING_COUNT, RADIUS);

  const boxesLayer = view.addMesh<InstancedBoxMeshDesc>({
    boxes: {
      emissiveIntensity: 0.6,
      children: buildings,
    },
    effectIds: [bloomEffect.id],
    matrixWorld,
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

  const pane = new Pane({ title: "Instanced Mesh" });
  pane.addButton({ title: "Add 100 Buildings" }).on("click", () => {
    const newBuildings = generateBuildings(100, RADIUS);
    for (const b of newBuildings) {
      boxesLayer.ref.add(b);
    }
  });

  attribution?.add([TILE_DATASETS.openstreetmap, TERRAIN_DATASETS.gsi]);
};

run();
