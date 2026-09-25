import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
  geodeticToVector3,
} from "@navaramap/three";
import type {
  BoxMeshDesc,
  SelectiveBloomEffectDesc,
  SelectiveOutlineEffectDesc,
  SphereMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Vector3 } from "three";
import { Pane } from "tweakpane";

import {
  TILE_DATASETS,
  TILES_3D_DATASETS,
  TERRAIN_DATASETS,
} from "../../../helpers/constants";
import { atZoneTime } from "../../../helpers/control";

import { DebugPlugin } from "./DebugPlugin";

export const run = async (view: ThreeView<DefaultDescriptions>) => {
  const plugin = new DefaultPlugin();
  const debugPlugin = new DebugPlugin();
  view.addPlugin(plugin);
  view.addPlugin(debugPlugin);
  const attribution = view.attribution;
  await view.init();

  // Camera: Tokyo Station area
  view.setCamera({
    lng: 139.7511145474829,
    lat: 35.67364356091717,
    height: 902.0,
    heading: 64.41840149763287,
    pitch: -36.00000121921312,
    roll: 0,
  });

  const defaultAtmosphere = plugin.addDefaultPhotorealScene();
  defaultAtmosphere.sun.update({
    sun: { intensity: 1, castShadow: true },
  });

  const date = atZoneTime(new Date(), 8);
  view.atmosphere.date = date;

  // --- Effect Descriptor definitions ---

  const bloomEffect = view.addEffect<SelectiveBloomEffectDesc>({
    selectiveBloom: {
      strength: 1.0,
      radius: 0.5,
      threshold: 0.0,
      resolutionScale: 1.0,
    },
  });

  const outlineEffect = view.addEffect<SelectiveOutlineEffectDesc>({
    selectiveOutline: {
      color: new Color().setHex(0xff0000),
      thickness: 2.0,
      edgeStrength: 1.0,
      resolutionScale: 1.0,
    },
  });

  // --- Mesh Descriptors (effectIds reference effect descriptor IDs) ---

  // Cube at Tokyo Station (bloom only)
  const boxPosition = geodeticToVector3({
    lat: 35.6812,
    lng: 139.7671,
    height: 200,
  });
  const boxLayer = view.addMesh<BoxMeshDesc>({
    box: {
      width: 200,
      height: 200,
      depth: 200,
      color: new Color().setHex(0xff0000),
      emissiveColor: new Color().setHex(0xff0000),
      emissiveIntensity: 1.0,
      effectIds: [bloomEffect.id],
    },
    position: { x: boxPosition.x, y: boxPosition.y, z: boxPosition.z },
  });

  // Sphere near Tokyo Station (bloom + outline)
  const spherePosition = new Vector3(
    boxPosition.x,
    boxPosition.y,
    boxPosition.z,
  ).add(new Vector3(-500, 0, -600));
  const sphereLayer = view.addMesh<SphereMeshDesc>({
    sphere: {
      radius: 150,
      color: new Color().setHex(0x0000ff),
      emissiveColor: new Color().setHex(0x0000ff),
      emissiveIntensity: 1.0,
      effectIds: [bloomEffect.id, outlineEffect.id],
    },
    position: { x: spherePosition.x, y: spherePosition.y, z: spherePosition.z },
  });

  // 3D Tiles: Chiyoda (outline only)
  const chiyodaSource = view.addSource({
    type: "3d-tiles",
    url: TILES_3D_DATASETS.plateauChiyoda.url,
  });
  const chiyodaLayer = view.addLayer({
    type: "3d-tiles",
    source: chiyodaSource,
    model: {
      color: new Color().setHex(0xffffff),
      emissiveColor: new Color().setHex(0xffffff),
      emissiveIntensity: 0.0,
      effectIds: [outlineEffect.id],
    },
  });

  // 3D Tiles: Chuo (no effects)
  const chuoSource = view.addSource({
    type: "3d-tiles",
    url: TILES_3D_DATASETS.plateauChuo.url,
  });
  view.addLayer({
    type: "3d-tiles",
    source: chuoSource,
    model: {
      color: new Color().setHex(0xffffff),
    },
  });

  // Base tiles
  const osmSource = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 23,
  });
  view.addLayer({
    type: "raster",
    source: osmSource,
  });

  const gsiDem = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    maxZoom: 15,
    minZoom: 5,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  });
  view.addLayer({
    type: "raster",
    source: gsiDem,
    hillshade: {},
  });
  view.addLayer({
    type: "terrain",
    source: gsiDem,
  });

  attribution?.add([
    TILE_DATASETS.openstreetmap,
    TERRAIN_DATASETS.gsi,
    TILES_3D_DATASETS.plateauChiyoda,
    TILES_3D_DATASETS.plateauChuo,
  ]);

  // --- Debug Controls ---
  const pane = new Pane({ title: "Selective Effect Debug" });

  const debugParams = { debugView: true };
  pane
    .addBinding(debugParams, "debugView", { label: "SE Buffer Debug" })
    .on("change", (ev) => {
      debugPlugin.setEnabled(ev.value);
    });

  // --- Effect Descriptor Controls ---
  const effectFolder = pane.addFolder({ title: "Effects", expanded: true });
  const bloomFolder = effectFolder.addFolder({
    title: "Bloom",
    expanded: true,
  });
  const bloomParams = {
    strength: 1.0,
    radius: 0.5,
    threshold: 0.0,
    smoothing: 0.1,
    levels: 8,
  };
  bloomFolder
    .addBinding(bloomParams, "strength", {
      label: "Strength",
      min: 0,
      max: 5,
      step: 0.1,
    })
    .on("change", (ev) => {
      bloomEffect.update({ selectiveBloom: { strength: ev.value } });
    });
  bloomFolder
    .addBinding(bloomParams, "radius", {
      label: "Radius",
      min: 0,
      max: 1,
      step: 0.05,
    })
    .on("change", (ev) => {
      bloomEffect.update({ selectiveBloom: { radius: ev.value } });
    });
  bloomFolder
    .addBinding(bloomParams, "threshold", {
      label: "Threshold",
      min: 0,
      max: 1,
      step: 0.05,
    })
    .on("change", (ev) => {
      bloomEffect.update({ selectiveBloom: { threshold: ev.value } });
    });
  bloomFolder
    .addBinding(bloomParams, "smoothing", {
      label: "Smoothing",
      min: 0,
      max: 1,
      step: 0.01,
    })
    .on("change", (ev) => {
      bloomEffect.update({ selectiveBloom: { smoothing: ev.value } });
    });
  bloomFolder
    .addBinding(bloomParams, "levels", {
      label: "Levels",
      min: 1,
      max: 8,
      step: 1,
    })
    .on("change", (ev) => {
      bloomEffect.update({ selectiveBloom: { levels: ev.value } });
    });

  const outlineFolder = effectFolder.addFolder({
    title: "Outline",
    expanded: true,
  });
  const outlineParams = {
    color: "#ff0000",
    thickness: 2.0,
    edgeStrength: 1.0,
  };
  outlineFolder
    .addBinding(outlineParams, "color", { label: "Color" })
    .on("change", (ev) => {
      outlineEffect.update({
        selectiveOutline: { color: new Color().setStyle(ev.value) },
      });
    });
  outlineFolder
    .addBinding(outlineParams, "thickness", {
      label: "Thickness",
      min: 0,
      max: 5,
      step: 0.5,
    })
    .on("change", (ev) => {
      outlineEffect.update({ selectiveOutline: { thickness: ev.value } });
    });
  outlineFolder
    .addBinding(outlineParams, "edgeStrength", {
      label: "Edge Strength",
      min: 0,
      max: 3,
      step: 0.1,
    })
    .on("change", (ev) => {
      outlineEffect.update({ selectiveOutline: { edgeStrength: ev.value } });
    });

  // --- Mesh Emissive Controls ---
  const meshFolder = pane.addFolder({ title: "Meshes", expanded: true });
  const boxFolder = meshFolder.addFolder({ title: "Box", expanded: true });
  const boxParams = {
    emissiveColor: "#ff0000",
    emissiveIntensity: 1.0,
  };
  boxFolder
    .addBinding(boxParams, "emissiveColor", { label: "Emissive Color" })
    .on("change", (ev) => {
      boxLayer.update({
        box: { emissiveColor: new Color().setStyle(ev.value) },
      });
    });
  boxFolder
    .addBinding(boxParams, "emissiveIntensity", {
      label: "Intensity",
      min: 0,
      max: 2,
      step: 0.1,
    })
    .on("change", (ev) => {
      boxLayer.update({ box: { emissiveIntensity: ev.value } });
    });

  const sphereFolder = meshFolder.addFolder({
    title: "Sphere",
    expanded: true,
  });
  const sphereParams = {
    emissiveColor: "#0000ff",
    emissiveIntensity: 1.0,
  };
  sphereFolder
    .addBinding(sphereParams, "emissiveColor", { label: "Emissive Color" })
    .on("change", (ev) => {
      sphereLayer.update({
        sphere: { emissiveColor: new Color().setStyle(ev.value) },
      });
    });
  sphereFolder
    .addBinding(sphereParams, "emissiveIntensity", {
      label: "Intensity",
      min: 0,
      max: 2,
      step: 0.1,
    })
    .on("change", (ev) => {
      sphereLayer.update({ sphere: { emissiveIntensity: ev.value } });
    });

  const tiles3DFolder = meshFolder.addFolder({
    title: "3DTiles Chiyoda",
    expanded: true,
  });
  const tiles3DParams = {
    emissiveColor: "#ffffff",
    emissiveIntensity: 0.0,
  };
  tiles3DFolder
    .addBinding(tiles3DParams, "emissiveColor", { label: "Emissive Color" })
    .on("change", (ev) => {
      view.updateLayerById(chiyodaLayer.id, {
        model: { emissiveColor: new Color().setStyle(ev.value) },
      });
    });
  tiles3DFolder
    .addBinding(tiles3DParams, "emissiveIntensity", {
      label: "Intensity",
      min: 0,
      max: 2,
      step: 0.1,
    })
    .on("change", (ev) => {
      view.updateLayerById(chiyodaLayer.id, {
        model: { emissiveIntensity: ev.value },
      });
    });
};
