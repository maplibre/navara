import ThreeView, { Color, type LayerDescription } from "@navaramap/three";
import { SSREffectDesc, SkyMeshDesc } from "@navaramap/three-default-descs";
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
  // The watermask's water takes `waterMaskColor` as its body color; without
  // it, the imagery under the sea shows through.
  const terrainLayer = view.addLayer({
    type: "terrain",
    source: terrain,
    terrain: {
      receiveShadow: true,
      castShadow: true,
      waterMaskColor: new Color().setStyle(DEEP_SEA_STYLE),
    },
  });
  // The watermask's sea has its own waves, set on the terrain layer.
  const setWaterMaskWaves = (waves: {
    waveExaggeration?: number;
    waveStrength?: number;
    waveDirection?: number;
    flowSpeed?: number;
  }) => {
    terrainLayer.update({ terrain: waves });
  };
  // `undefined` returns the water to the imagery's color.
  const setWaterMaskColor = (color: Color | undefined) => {
    terrainLayer.update({ terrain: { waterMaskColor: color } });
  };

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
  addWaterControls(view, pane, setWaterMaskColor, setWaterMaskWaves);

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

/** Body color of deep open-ocean water. */
const DEEP_SEA_STYLE = "#0d1c2c";

const addWaterControls = (
  view: ThreeView<CustomDescriptions>,
  pane: Pane,
  setWaterMaskColor: (color: Color | undefined) => void,
  setWaterMaskWaves: (waves: {
    waveExaggeration?: number;
    waveStrength?: number;
    waveDirection?: number;
    flowSpeed?: number;
  }) => void,
) => {
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

  const mvtPolygon = {
    color: new Color().setStyle("#001e0f"),
    clampToGround: true,
    water: true,
    waveExaggeration: 1,
    waterScale: "ocean",
    waveStrength: 5,
    waveDirection: 0,
    flowSpeed: 0,
  };
  const geoJsonPolygon = {
    color: new Color().setStyle("#001e0f"),
    height: 70,
    extrudedHeight: 1,
    clampToGround: false,
    receiveShadow: false,
    water: true,
    waveExaggeration: 1,
    waterScale: "ocean",
    waveStrength: 5,
    waveDirection: 0,
    flowSpeed: 0,
  };
  const layerDesc = (dataType: string): LayerDescription =>
    dataType === "mvt"
      ? {
          type: "vector",
          source: waterTileSource.id,
          sourceLayers: ["waterarea"],
          polygon: mvtPolygon,
        }
      : {
          type: "vector",
          source: waterGeojsonSource.id,
          polygon: geoJsonPolygon,
        };

  const waterParams = {
    dataType: "geojson",
    show: true,
    water: true,
    waveExaggeration: 1,
    waterScale: "ocean",
    waveStrength: 5,
    waveDirection: 0,
    flowSpeed: 0,
    skyEnvMap: true,
    useWaterMaskColor: true,
    waterMaskColor: DEEP_SEA_STYLE,
  };
  let waterLayer = view.addLayer(layerDesc(waterParams.dataType));
  // Water reflects this sky; without it, it falls back to the light probe.
  const addSkyEnvMap = () =>
    view.addMesh<SkyMeshDesc>({ sky: { envMap: true } });
  let skyEnvMap = addSkyEnvMap();

  const updatePolygons = (
    update: Partial<typeof mvtPolygon & { show: boolean }>,
  ) => {
    Object.assign(mvtPolygon, update);
    Object.assign(geoJsonPolygon, update);
    waterLayer.update(layerDesc(waterParams.dataType));
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
        waterLayer = view.addLayer(layerDesc(v.value));
      },
    },
    {
      // Hide the water polygon to see the terrain watermask's sea, which
      // shades as water too.
      name: "show",
      onChange: (v) => updatePolygons({ show: v.value }),
    },
    {
      name: "water",
      onChange: (v) => updatePolygons({ water: v.value }),
    },
    {
      name: "waveExaggeration",
      params: { min: 0, max: 2, step: 0.01 },
      onChange: (v) => {
        updatePolygons({ waveExaggeration: v.value });
        setWaterMaskWaves({ waveExaggeration: v.value });
      },
    },
    {
      // The extent of the water body, which caps its wave size.
      name: "waterScale",
      params: {
        options: ["ocean", "large", "medium", "small"].map((value) => ({
          text: value,
          value,
        })),
      },
      onChange: (v) => updatePolygons({ waterScale: v.value }),
    },
    {
      // Sets the waves' size, slope and speed. Applied to the polygon layer
      // and to the watermask's sea.
      name: "waveStrength",
      params: { min: 0, max: 20, step: 0.1 },
      onChange: (v) => {
        updatePolygons({ waveStrength: v.value });
        setWaterMaskWaves({ waveStrength: v.value });
      },
    },
    {
      // Where the waves travel, clockwise from north.
      name: "waveDirection",
      params: { min: 0, max: 360, step: 1 },
      onChange: (v) => {
        updatePolygons({ waveDirection: v.value });
        setWaterMaskWaves({ waveDirection: v.value });
      },
    },
    {
      // The current carrying the waves along waveDirection, in m/s.
      name: "flowSpeed",
      params: { min: 0, max: 10, step: 0.1 },
      onChange: (v) => {
        updatePolygons({ flowSpeed: v.value });
        setWaterMaskWaves({ flowSpeed: v.value });
      },
    },
    {
      // Off renders no env map, so the water reflects the light probe's
      // low-frequency sky.
      name: "skyEnvMap",
      onChange: (v) => {
        if (v.value) {
          skyEnvMap = addSkyEnvMap();
        } else {
          skyEnvMap.delete();
        }
      },
    },
    {
      // Off shows the imagery under the watermask's sea as its body color.
      name: "useWaterMaskColor",
      onChange: (v) =>
        setWaterMaskColor(
          v.value
            ? new Color().setStyle(waterParams.waterMaskColor)
            : undefined,
        ),
    },
    {
      name: "waterMaskColor",
      onChange: (v) => {
        if (waterParams.useWaterMaskColor) {
          setWaterMaskColor(new Color().setStyle(v.value));
        }
      },
    },
  ];

  addFieldsToFolder(
    pane.addFolder({ title: "Water Settings" }),
    waterParams,
    fields,
  );
};
