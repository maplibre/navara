import ThreeView, { Color, type LayerDescription } from "@navaramap/three";
import { SSREffectDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import {
  TERRAIN_DATASETS,
  TILE_DATASETS,
  TILES_3D_DATASETS,
  VECTOR_DATASETS,
} from "../../helpers/constants";
import { addCameraControl, addDateControl } from "../../helpers/control";
import { addFieldsToFolder, type FolderFields } from "../../helpers/panel";

export type CustomDescriptions = DefaultDescriptions;

export const run = async (view: ThreeView<CustomDescriptions>) => {
  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const attribution = view.attribution;

  await view.init();

  view.toneMappingExposure = 10;

  const defaultAtmospheres = defaultPlugin.addDefaultPhotorealScene();
  defaultAtmospheres.sun.update({
    sun: {
      castShadow: true,
    },
  });

  const baseImagery = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.gsiSeamlessphoto.url,
    maxZoom: 23,
  });
  view.addLayer({ type: "raster", source: baseImagery });

  // Quantized-mesh terrain with the watermask: ocean pixels automatically
  // receive the default reflectivity/roughness, so SSR reflects on the sea
  // without any water polygon layer.
  const terrain = view.addSource({
    type: "quantized-mesh",
    url: TERRAIN_DATASETS.reearthQuantizedMesh.url,
    maxZoom: 18,
    requestVertexNormals: true,
    requestWaterMask: true,
  });
  view.addLayer({
    type: "terrain",
    source: terrain,
    terrain: { receiveShadow: true, castShadow: true },
  });

  for (const dataset of [
    TILES_3D_DATASETS.plateauChiyoda,
    TILES_3D_DATASETS.plateauChuo,
  ]) {
    const buildings = view.addSource({
      type: "3d-tiles",
      url: dataset.url,
    });
    view.addLayer({
      type: "3d-tiles",
      source: buildings,
      model: {
        show: true,
        color: new Color().setStyle("#ffffff"),
        metalness: 0,
        roughness: 0.5,
        castShadow: true,
        receiveShadow: true,
      },
    });
  }

  // Create controls panel
  const pane = new Pane({ title: "SSR Water Reflection Example" });
  pane.element.style.maxHeight = "98vh";
  pane.element.style.overflow = "scroll";

  view.setCamera({
    lng: 139.7511145474829,
    lat: 35.67364356091717,
    height: 902.0,
    heading: 64.41840149763287,
    pitch: -36.00000121921312,
    roll: 0,
  });

  // Camera controls
  addCameraControl(view, pane);

  // Date/Time controls for sun position
  addDateControl(view, pane);

  // SSR controls
  addSSRControls(view, pane);

  // Water polygon controls
  addWaterControls(view, pane);

  attribution?.add([
    TERRAIN_DATASETS.reearthQuantizedMesh,
    TILE_DATASETS.gsiSeamlessphoto,
    TILES_3D_DATASETS.plateauChiyoda,
    TILES_3D_DATASETS.plateauChuo,
    VECTOR_DATASETS.gsiExperimentalVector,
  ]);
};

const addSSRControls = (view: ThreeView<CustomDescriptions>, pane: Pane) => {
  // Add SSR effect descriptor
  let ssrLayer = view.addEffect<SSREffectDesc>({
    ssr: {},
  });

  const ssrParams = {
    visible: ssrLayer.visible,
    resolutionScale: ssrLayer.ref.raw?.resolutionScale ?? 0.5,
    iterations: ssrLayer.ref.raw?.iterations ?? 16,
    binarySearchIterations: ssrLayer.ref.raw?.binarySearchIterations ?? 4,
    pixelZSize: ssrLayer.ref.raw?.pixelZSize ?? 0.1,
    pixelStride: ssrLayer.ref.raw?.pixelStride ?? 16,
    pixelStrideZCutoff: ssrLayer.ref.raw?.pixelStrideZCutoff ?? 10,
    maxRayDistance: ssrLayer.ref.raw?.maxRayDistance ?? 200,
    screenEdgeFadeStart: ssrLayer.ref.raw?.screenEdgeFadeStart ?? 0.9,
    eyeFadeStart: ssrLayer.ref.raw?.eyeFadeStart ?? 0.4,
    eyeFadeEnd: ssrLayer.ref.raw?.eyeFadeEnd ?? 0.8,
    jitter: ssrLayer.ref.raw?.jitter ?? 0,
    useConeTracing: ssrLayer.ref.raw?.useConeTracing ?? false,
    coneTracingFadeStart: ssrLayer.ref.raw?.coneTracingFadeStart ?? 0,
    coneTracingFadeEnd: ssrLayer.ref.raw?.coneTracingFadeEnd ?? 0,
    coneTracingMaxDistance: ssrLayer.ref.raw?.coneTracingMaxDistance ?? 0,
    coneTracingIteration: ssrLayer.ref.raw?.coneTracingIteration ?? 0,
  };

  const fields: FolderFields<typeof ssrParams> = [
    {
      name: "visible",
      onChange: (v) => {
        if (v.value) {
          ssrLayer = view.addEffect<SSREffectDesc>({
            ssr: ssrParams,
          });
        } else {
          ssrLayer.delete();
        }
      },
    },
    {
      name: "resolutionScale",
      params: { min: 0.1, max: 1, step: 0.1 },
      onChange: (v) => {
        ssrParams.resolutionScale = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "iterations",
      params: { min: 1, step: 1 },
      onChange: (v) => {
        ssrParams.iterations = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "binarySearchIterations",
      params: { min: 0, step: 1 },
      onChange: (v) => {
        ssrParams.binarySearchIterations = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "pixelZSize",
      params: { min: 0 },
      onChange: (v) => {
        ssrParams.pixelZSize = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "pixelStride",
      params: { min: 0 },
      onChange: (v) => {
        ssrParams.pixelStride = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "pixelStrideZCutoff",
      params: { min: 0 },
      onChange: (v) => {
        ssrParams.pixelStrideZCutoff = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "maxRayDistance",
      params: { min: 0 },
      onChange: (v) => {
        ssrParams.maxRayDistance = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "screenEdgeFadeStart",
      params: { min: 0 },
      onChange: (v) => {
        ssrParams.screenEdgeFadeStart = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "eyeFadeStart",
      params: { min: 0 },
      onChange: (v) => {
        ssrParams.eyeFadeStart = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "eyeFadeEnd",
      params: { min: 0 },
      onChange: (v) => {
        ssrParams.eyeFadeEnd = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "jitter",
      params: { min: 0, max: 1 },
      onChange: (v) => {
        ssrParams.jitter = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "useConeTracing",
      onChange: (v) => {
        ssrParams.useConeTracing = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "coneTracingFadeStart",
      params: { min: 0, max: 1 },
      onChange: (v) => {
        ssrParams.coneTracingFadeStart = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "coneTracingFadeEnd",
      params: { min: 0, max: 1 },
      onChange: (v) => {
        ssrParams.coneTracingFadeEnd = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "coneTracingMaxDistance",
      params: { min: 0 },
      onChange: (v) => {
        ssrParams.coneTracingMaxDistance = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
    {
      name: "coneTracingIteration",
      params: { min: 0, step: 1 },
      onChange: (v) => {
        ssrParams.coneTracingIteration = v.value;
        ssrLayer.update({ ssr: ssrParams });
      },
    },
  ];

  addFieldsToFolder(
    pane.addFolder({ title: "SSR Settings" }),
    ssrParams,
    fields,
  );
};

const addWaterControls = (view: ThreeView<CustomDescriptions>, pane: Pane) => {
  // Vector-tile and GeoJSON sources for the two water data variants.
  const waterTileSource = view.addSource({
    type: "vector-tile",
    url: VECTOR_DATASETS.gsiExperimentalVector.url,
    maxZoom: 16,
  });
  const waterGeojsonSource = view.addSource({
    type: "geojson",
    data: {
      type: "Feature",
      properties: null,
      geometry: {
        coordinates: [
          [
            [139.64114960199845, 35.77501909535009],
            [139.64114960199845, 35.6170718697025],
            [139.90177394130632, 35.6170718697025],
            [139.90177394130632, 35.77501909535009],
            [139.64114960199845, 35.77501909535009],
          ],
        ],
        type: "Polygon",
      },
    },
  });

  // Store the layer description object
  const mvtDesc: LayerDescription = {
    type: "vector",
    source: waterTileSource.id,
    sourceLayers: ["waterarea"],
    polygon: {
      color: new Color().setStyle("#001e0f"),
      reflectivity: 0.02,
      clampToGround: true,
      wireframe: false,
      water: true,
      shininess: 100,
      specularStrength: 2,
      applyWaterNormal: false,
      specular: false,
      ior: 1.33333,
      transparent: false,
      opacity: 1.0,
    },
  };
  const geoJsonDesc: LayerDescription = {
    type: "vector",
    source: waterGeojsonSource.id,
    polygon: {
      color: new Color().setStyle("#001e0f"),
      height: 70,
      extrudedHeight: 1,
      clampToGround: false,
      wireframe: false,
      reflectivity: 0.02,
      roughness: 0.2,
      receiveShadow: false,
      water: true,
      shininess: 100,
      specularStrength: 2,
      applyWaterNormal: false,
      specular: true,
      ior: 1.33333,
      transparent: false,
      opacity: 1.0,
    },
  };

  let waterLayer = view.addLayer(geoJsonDesc);

  const waterParams = {
    dataType: "geojson",
    show: mvtDesc.polygon?.show ?? true,
    reflectivity: mvtDesc.polygon?.reflectivity ?? 0,
    roughness: mvtDesc.polygon?.roughness ?? 0,
    water: mvtDesc.polygon?.water ?? true,
    waterScaleNormal: mvtDesc.polygon?.waterScaleNormal ?? 0.1,
    waterSpeed: mvtDesc.polygon?.waterSpeed ?? 0.0003,
    shininess: mvtDesc.polygon?.shininess ?? 100,
    specularStrength: mvtDesc.polygon?.specularStrength ?? 2,
    applyWaterNormal: mvtDesc.polygon?.applyWaterNormal ?? false,
    specular: mvtDesc.polygon?.specular ?? false,
    ior: mvtDesc.polygon?.ior ?? 1.33333,
    transparent: mvtDesc.polygon?.transparent ?? false,
    opacity: mvtDesc.polygon?.opacity ?? 1.0,
  };

  const fields: FolderFields<typeof waterParams> = [
    {
      name: "dataType",
      params: {
        options: [
          { text: "geojson", value: "geojson" },
          { text: "mvt", value: "mvt" },
        ],
      },
      onChange: (v) => {
        waterParams.dataType = v.value;
        waterLayer.delete();
        switch (v.value) {
          case "mvt": {
            waterLayer = view.addLayer(mvtDesc);
            break;
          }
          case "geojson": {
            waterLayer = view.addLayer(geoJsonDesc);
            break;
          }
        }
      },
    },
    {
      // Hide the water polygon to observe the terrain watermask's ocean
      // reflection without the polygon covering the bay.
      name: "show",
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.show = v.value;
        mvtDesc.polygon.show = v.value;
        geoJsonDesc.polygon.show = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "reflectivity",
      params: { min: 0, max: 1, step: 0.01 },
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.reflectivity = v.value;
        mvtDesc.polygon.reflectivity = v.value;
        geoJsonDesc.polygon.reflectivity = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "roughness",
      params: { min: 0, max: 1, step: 0.01 },
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.roughness = v.value;
        mvtDesc.polygon.roughness = v.value;
        geoJsonDesc.polygon.roughness = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "water",
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.water = v.value;
        mvtDesc.polygon.water = v.value;
        geoJsonDesc.polygon.water = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "waterScaleNormal",
      params: { min: 0.01, max: 1.0, step: 0.01 },
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.waterScaleNormal = v.value;
        mvtDesc.polygon.waterScaleNormal = v.value;
        geoJsonDesc.polygon.waterScaleNormal = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "waterSpeed",
      params: { min: 0.0, max: 0.01, step: 0.0001 },
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.waterSpeed = v.value;
        mvtDesc.polygon.waterSpeed = v.value;
        geoJsonDesc.polygon.waterSpeed = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "shininess",
      params: { min: 0, max: 200, step: 1 },
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.shininess = v.value;
        mvtDesc.polygon.shininess = v.value;
        geoJsonDesc.polygon.shininess = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "specularStrength",
      params: { min: 0, max: 10, step: 0.1 },
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.specularStrength = v.value;
        mvtDesc.polygon.specularStrength = v.value;
        geoJsonDesc.polygon.specularStrength = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "applyWaterNormal",
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.applyWaterNormal = v.value;
        mvtDesc.polygon.applyWaterNormal = v.value;
        geoJsonDesc.polygon.applyWaterNormal = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "specular",
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.specular = v.value;
        mvtDesc.polygon.specular = v.value;
        geoJsonDesc.polygon.specular = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "ior",
      params: { min: 1.0, max: 2.5, step: 0.01 },
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.ior = v.value;
        mvtDesc.polygon.ior = v.value;
        geoJsonDesc.polygon.ior = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "transparent",
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.transparent = v.value;
        mvtDesc.polygon.transparent = v.value;
        geoJsonDesc.polygon.transparent = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
    {
      name: "opacity",
      params: { min: 0, max: 1, step: 0.01 },
      onChange: (v) => {
        if (!mvtDesc.polygon || !geoJsonDesc.polygon) return;
        waterParams.opacity = v.value;
        mvtDesc.polygon.opacity = v.value;
        geoJsonDesc.polygon.opacity = v.value;
        waterLayer.update(
          waterParams.dataType === "mvt" ? mvtDesc : geoJsonDesc,
        );
      },
    },
  ];

  addFieldsToFolder(
    pane.addFolder({ title: "Water Settings" }),
    waterParams,
    fields,
  );
};
