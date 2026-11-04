import ThreeView, {
  JAPAN_GSI_ELEVATION_DECODER,
  MeshHandle,
  EffectHandle,
  type LayerDescription,
  geodeticToVector3,
  Color,
} from "@navaramap/three";
import {
  RainMeshDesc,
  SnowMeshDesc,
  RainDropEffectDesc,
  SSREffectDesc,
  CloudsEffectDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Vector2 } from "three";
import { Pane } from "tweakpane";

import {
  TERRAIN_DATASETS,
  TILE_DATASETS,
  TILES_3D_DATASETS,
  VECTOR_DATASETS,
} from "../../helpers/constants";
import {
  addDateControl,
  addHidePaneKeyShortcut,
  atZoneTime,
} from "../../helpers/control";
import { addFieldsToFolder, type FolderFields } from "../../helpers/panel";

export type CustomDescriptions = DefaultDescriptions;

export const run = async (view: ThreeView<CustomDescriptions>) => {
  const plugin = new DefaultPlugin();
  view.addPlugin(plugin);

  const attribution = view.attribution;

  await view.init();

  const defaultEffects = plugin.addDefaultPhotorealScene();

  // Add clouds effect descriptor explicitly
  const cloudsLayer = view.addEffect<CloudsEffectDesc>({
    clouds: {},
  });

  defaultEffects.aerialPerspective.update({
    aerialPerspective: {
      irradiance: true,
    },
  });

  view.addEffect<SSREffectDesc>({
    visible: true,
    ssr: {},
  });

  view.setCamera({
    lng: 139.7371145474829,
    lat: 35.67564356091717,
    height: 402.0,
    heading: 64.41840149763287, // -180 to 180
    pitch: -16.00000121921312, // -180 to 0
    roll: 0, // -180 to 180
  });

  const date = atZoneTime(new Date(), 8);

  view.atmosphere.date = date;

  cloudsLayer.update({
    clouds: {
      qualityPreset: "high",
      localWeatherVelocity: new Vector2(0.005, 0.001),
      coverage: 0.45,
      absorptionCoefficient: 5,
      lightShafts: true,
      shadows: true,
      haze: true,
      hazeDensityScale: 0.0003,
      hazeExponent: 0.002,
      hazeAbsorptionCoefficient: 1.5,
    },
  });

  view.toneMappingExposure = 10;

  const seamlessphotoSource = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.gsiSeamlessphoto.url,
    maxZoom: 23,
  });
  view.addLayer({
    type: "raster",
    source: seamlessphotoSource,
  });

  const gsiTerrainDem = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.gsi.url,
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
    maxZoom: 15,
    minZoom: 5,
  });
  view.addLayer({
    type: "terrain",
    source: gsiTerrainDem,
    terrain: {
      receiveShadow: true,
    },
  });

  view.addLayer({
    type: "raster",
    source: gsiTerrainDem,
    hillshade: {},
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
      castShadow: true,
      receiveShadow: true,
      height: -50,
    },
  });

  // Add Sample Post Effect with two circles
  const rainDropEffect = view.addEffect<RainDropEffectDesc>({
    rainDrop: {
      opacity: 1.0,
      dropGridSize: 12,
      dropDensity: 1,
      dropLayers: 4,
      dropSizeFactor: 0.015,
      noiseScale: 200,
      refractionStrength: 0.3,
      minDropStrength: 0.01,
      dropFadeStart: 0.3,
      dropFadeEnd: 0.8,
      dropThresholdFactor: 0.08,
      gridDensityLow: 1.15,
      gridDensityHigh: 0.85,
      jitterStrengthLow: 0.45,
      jitterStrengthHigh: 0.08,
    },
    visible: false,
  });

  const plateauChuoSource = view.addSource({
    type: "3d-tiles",
    url: TILES_3D_DATASETS.plateauChuo.url,
  });
  view.addLayer({
    type: "3d-tiles",
    source: plateauChuoSource,
    model: {
      show: true,
      color: new Color().setStyle("#ffffff"),
      metalness: 0,
      roughness: 1,
      height: -50,
    },
  });

  const pane = new Pane({
    title: "Parameters",
    expanded: true,
  });

  addHidePaneKeyShortcut(pane);

  addDateControl(view, pane);
  addCameraControl(view, pane);
  addWaterControl(view, pane);
  addWeatherControl(view, pane, rainDropEffect);

  attribution?.add([
    TERRAIN_DATASETS.gsi,
    TILE_DATASETS.gsiSeamlessphoto,
    TILES_3D_DATASETS.plateauChiyoda,
    TILES_3D_DATASETS.plateauChuo,
    TILES_3D_DATASETS.plateauTokyoFlood,
    VECTOR_DATASETS.gsiExperimentalVector,
  ]);
};

const addWaterControl = (view: ThreeView<CustomDescriptions>, pane: Pane) => {
  const PARAMS = {
    "visible flood model": true,
    "visible river model": true,
  };

  const floodSource = view.addSource({
    type: "3d-tiles",
    url: TILES_3D_DATASETS.plateauTokyoFlood.url,
  });
  const floodDesc: LayerDescription = {
    type: "3d-tiles",
    source: floodSource,
    model: {
      show: true,
      color: new Color().setStyle("#ffdcad"),
      metalness: 0.02,
      roughness: 0.3,
      reflectivity: 0.2,
      receiveShadow: true,
      height: -20,
      water: true,
    },
  };

  const riverSource = view.addSource({
    type: "vector-tile",
    url: VECTOR_DATASETS.gsiExperimentalVector.url,
    maxZoom: 16,
  });
  const riverDesc: LayerDescription = {
    type: "vector",
    source: riverSource,
    sourceLayers: ["waterarea"],
    polygon: {
      color: new Color().setStyle("#cef7ff"),
      reflectivity: 0.2,
      clampToGround: true,
      wireframe: false,
      water: true,
    },
  };

  const floodModelLayer = view.addLayer(floodDesc);
  const riverModelLayer = view.addLayer(riverDesc);

  const folder = pane.addFolder({
    title: "Water",
  });

  folder.addBinding(PARAMS, "visible flood model").on("change", (v) => {
    if (floodDesc.model) {
      floodDesc.model.show = v.value;
    }
    floodModelLayer.update(floodDesc);
  });

  folder.addBinding(PARAMS, "visible river model").on("change", (v) => {
    if (riverDesc.polygon) {
      riverDesc.polygon.show = v.value;
    }
    riverModelLayer.update(riverDesc);
  });
};

const addCameraControl = (view: ThreeView<CustomDescriptions>, pane: Pane) => {
  const PARAMS = {
    autoRotation: false,
  };
  const folder = pane.addFolder({
    title: "Camera",
  });

  let frameId: number;
  folder.addBinding(PARAMS, "autoRotation").on("change", (v) => {
    if (!v.value) {
      cancelAnimationFrame(frameId);
      return;
    }

    const animateFunc = () => {
      view.rotateAround(0.002);
      frameId = requestAnimationFrame(animateFunc);
    };
    animateFunc();
  });
};

const addWeatherControl = (
  view: ThreeView<CustomDescriptions>,
  pane: Pane,
  rainDropEffect: EffectHandle<RainDropEffectDesc>,
) => {
  const position = geodeticToVector3({
    lat: 35.67564356091717,
    lng: 139.74511454748298,
    height: 10,
  });

  const rain = view.addMesh<RainMeshDesc>({
    visible: false,
    position: position,
    rain: {},
  });
  const snow = view.addMesh<SnowMeshDesc>({
    visible: false,
    position: position,
    snow: {},
  });

  type WeatherType = "sunny" | "rainy" | "snowy";

  const PARAMS = {
    weather: "sunny" as WeatherType,
  };

  let selectedLayer:
    MeshHandle<RainMeshDesc> | MeshHandle<SnowMeshDesc> | null = null;

  const folderFields: FolderFields<typeof PARAMS> = [
    {
      name: "weather",
      params: {
        options: (["sunny", "rainy", "snowy"] as WeatherType[]).map((v) => ({
          text: v,
          value: v,
        })),
      },
      onChange: (v) => {
        switch (v.value) {
          case "sunny": {
            selectedLayer = null;
            break;
          }
          case "rainy": {
            selectedLayer = rain;
            break;
          }
          case "snowy": {
            selectedLayer = snow;
            break;
          }
        }

        rain.visible = false;
        snow.visible = false;
        rainDropEffect.visible = false;

        if (!selectedLayer) return;

        selectedLayer.visible = true;

        if (selectedLayer === rain) {
          rainDropEffect.visible = true;
        }
      },
    },
  ];

  const folder = pane.addFolder({
    title: "Weather",
  });
  addFieldsToFolder(folder, PARAMS, folderFields);

  // Rain

  const RAIN_PARAMS = {
    opacity: rain.ref?.raw?.opacity,
    particleCount: rain.ref?.raw?.particleCount,
    speed: rain.ref?.raw?.speed,
    color: rain.ref?.raw?.color,
    width: rain.ref?.raw?.width,
    height: rain.ref?.raw?.height,
    areaWidth: rain.ref?.raw?.areaWidth,
    areaHeight: rain.ref?.raw?.areaHeight,
    maxHeight: rain.ref?.raw?.maxHeight,
    alphaMax: rain.ref?.raw?.alphaMax,
    alphaMin: rain.ref?.raw?.alphaMin,
  };

  const rainFolderFields: FolderFields<typeof RAIN_PARAMS> = [
    {
      name: "opacity",
      params: {
        min: 0,
        max: 1,
      },
      onChange: (v) => {
        rain.update({
          rain: {
            opacity: v.value,
          },
        });
      },
    },
    {
      name: "particleCount",
      params: {
        min: 0,
      },
      onChange: (v) => {
        rain.update({
          rain: {
            particleCount: v.value,
          },
        });
      },
    },
    {
      name: "speed",
      params: {
        min: 0,
      },
      onChange: (v) => {
        rain.update({
          rain: {
            speed: v.value,
          },
        });
      },
    },
    {
      name: "color",
      params: {
        color: {
          alpha: false,
          type: "int",
        },
      },
      onChange: (v) => {
        rain.update({
          rain: {
            color: v.value,
          },
        });
      },
    },
    {
      name: "width",
      params: {
        min: 0,
      },
      onChange: (v) => {
        rain.update({
          rain: {
            width: v.value,
          },
        });
      },
    },
    {
      name: "height",
      params: {
        min: 0,
      },
      onChange: (v) => {
        rain.update({
          rain: {
            height: v.value,
          },
        });
      },
    },
    {
      name: "areaWidth",
      params: {
        min: 100,
      },
      onChange: (v) => {
        rain.update({
          rain: {
            areaWidth: v.value,
          },
        });
      },
    },
    {
      name: "areaHeight",
      params: {
        min: 100,
      },
      onChange: (v) => {
        rain.update({
          rain: {
            areaHeight: v.value,
          },
        });
      },
    },
    {
      name: "maxHeight",
      params: {
        min: 100,
      },
      onChange: (v) => {
        rain.update({
          rain: {
            maxHeight: v.value,
          },
        });
      },
    },
    {
      name: "alphaMax",
      params: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        rain.update({
          rain: {
            alphaMax: v.value,
          },
        });
      },
    },
    {
      name: "alphaMin",
      params: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        rain.update({
          rain: {
            alphaMin: v.value,
          },
        });
      },
    },
  ];

  const rainFolder = pane.addFolder({
    title: "Rain",
  });
  addFieldsToFolder(rainFolder, RAIN_PARAMS, rainFolderFields);

  const rainDropDefaults = {
    opacity: 1,
    dropGridSize: 12,
    dropDensity: 1,
    dropLayers: 4,
    dropSizeFactor: 0.015,
    noiseScale: 200,
    refractionStrength: 0.3,
    minDropStrength: 0.01,
    dropFadeStart: 0.3,
    dropFadeEnd: 0.8,
    dropThresholdFactor: 0.08,
    gridDensityLow: 1.15,
    gridDensityHigh: 0.85,
    jitterStrengthLow: 0.45,
    jitterStrengthHigh: 0.08,
  } as const;

  const RAIN_DROP_PARAMS = {
    ...rainDropDefaults,
    opacity: rainDropEffect.ref?.raw?.opacity ?? rainDropDefaults.opacity,
    dropGridSize:
      rainDropEffect.ref?.raw?.dropGridSize ?? rainDropDefaults.dropGridSize,
    dropDensity:
      rainDropEffect.ref?.raw?.dropDensity ?? rainDropDefaults.dropDensity,
    dropLayers:
      rainDropEffect.ref?.raw?.dropLayers ?? rainDropDefaults.dropLayers,
    dropSizeFactor:
      rainDropEffect.ref?.raw?.dropSizeFactor ??
      rainDropDefaults.dropSizeFactor,
    noiseScale:
      rainDropEffect.ref?.raw?.noiseScale ?? rainDropDefaults.noiseScale,
    refractionStrength:
      rainDropEffect.ref?.raw?.refractionStrength ??
      rainDropDefaults.refractionStrength,
    minDropStrength:
      rainDropEffect.ref?.raw?.minDropStrength ??
      rainDropDefaults.minDropStrength,
    dropFadeStart:
      rainDropEffect.ref?.raw?.dropFadeStart ?? rainDropDefaults.dropFadeStart,
    dropFadeEnd:
      rainDropEffect.ref?.raw?.dropFadeEnd ?? rainDropDefaults.dropFadeEnd,
    dropThresholdFactor:
      rainDropEffect.ref?.raw?.dropThresholdFactor ??
      rainDropDefaults.dropThresholdFactor,
    gridDensityLow:
      rainDropEffect.ref?.raw?.gridDensityLow ??
      rainDropDefaults.gridDensityLow,
    gridDensityHigh:
      rainDropEffect.ref?.raw?.gridDensityHigh ??
      rainDropDefaults.gridDensityHigh,
    jitterStrengthLow:
      rainDropEffect.ref?.raw?.jitterStrengthLow ??
      rainDropDefaults.jitterStrengthLow,
    jitterStrengthHigh:
      rainDropEffect.ref?.raw?.jitterStrengthHigh ??
      rainDropDefaults.jitterStrengthHigh,
  };

  const rainDropFolder = rainFolder.addFolder({
    title: "Rain Drop Effect",
  });

  addFieldsToFolder(rainDropFolder, RAIN_DROP_PARAMS, [
    {
      name: "opacity",
      params: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            opacity: v.value,
          },
        });
      },
    },
    {
      name: "dropGridSize",
      params: {
        min: 4,
        max: 24,
        step: 0.1,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            dropGridSize: v.value,
          },
        });
      },
    },
    {
      name: "dropDensity",
      params: {
        min: 0,
        max: 2,
        step: 0.01,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            dropDensity: v.value,
          },
        });
      },
    },
    {
      name: "dropLayers",
      params: {
        min: 1,
        max: 6,
        step: 1,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            dropLayers: v.value,
          },
        });
      },
    },
    {
      name: "dropSizeFactor",
      params: {
        min: 0.01,
        max: 0.03,
        step: 0.001,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            dropSizeFactor: v.value,
          },
        });
      },
    },
    {
      name: "noiseScale",
      params: {
        min: 50,
        max: 400,
        step: 1,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            noiseScale: v.value,
          },
        });
      },
    },
    {
      name: "refractionStrength",
      params: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            refractionStrength: v.value,
          },
        });
      },
    },
  ]);

  const rainDropAdvancedFolder = rainDropFolder.addFolder({
    title: "Advanced",
    expanded: false,
  });

  addFieldsToFolder(rainDropAdvancedFolder, RAIN_DROP_PARAMS, [
    {
      name: "minDropStrength",
      params: {
        min: 0,
        max: 0.05,
        step: 0.001,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            minDropStrength: v.value,
          },
        });
      },
    },
    {
      name: "dropFadeStart",
      params: {
        min: 0,
        max: 0.9,
        step: 0.01,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            dropFadeStart: v.value,
          },
        });
      },
    },
    {
      name: "dropFadeEnd",
      params: {
        min: 0.1,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            dropFadeEnd: v.value,
          },
        });
      },
    },
    {
      name: "dropThresholdFactor",
      params: {
        min: 0.02,
        max: 0.15,
        step: 0.005,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            dropThresholdFactor: v.value,
          },
        });
      },
    },
    {
      name: "gridDensityLow",
      params: {
        min: 0.8,
        max: 1.4,
        step: 0.01,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            gridDensityLow: v.value,
          },
        });
      },
    },
    {
      name: "gridDensityHigh",
      params: {
        min: 0.6,
        max: 1.1,
        step: 0.01,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            gridDensityHigh: v.value,
          },
        });
      },
    },
    {
      name: "jitterStrengthLow",
      params: {
        min: 0.2,
        max: 0.6,
        step: 0.01,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            jitterStrengthLow: v.value,
          },
        });
      },
    },
    {
      name: "jitterStrengthHigh",
      params: {
        min: 0.02,
        max: 0.2,
        step: 0.005,
      },
      onChange: (v) => {
        rainDropEffect.update({
          rainDrop: {
            jitterStrengthHigh: v.value,
          },
        });
      },
    },
  ]);

  rainDropFolder.addButton({ title: "Reset" }).on("click", () => {
    Object.assign(RAIN_DROP_PARAMS, rainDropDefaults);
    pane.refresh();
    rainDropEffect.update({ rainDrop: { ...rainDropDefaults } });
  });

  // Snow

  const SNOW_PARAMS = {
    opacity: snow.ref?.raw?.opacity,
    particleCount: snow.ref?.raw?.particleCount,
    speed: snow.ref?.raw?.speed,
    size: snow.ref?.raw?.size,
    color: snow.ref?.raw?.color,
    areaWidth: snow.ref?.raw?.areaWidth,
    areaHeight: snow.ref?.raw?.areaHeight,
    maxHeight: snow.ref?.raw?.maxHeight,
    xMovementStrength: snow.ref?.raw?.movementStrength.x ?? 0,
    xMovementSpeed: snow.ref?.raw?.movementSpeed.x ?? 0,
    yMovementStrength: snow.ref?.raw?.movementStrength.y ?? 0,
    yMovementSpeed: snow.ref?.raw?.movementSpeed.y ?? 0,
    zMovementStrength: snow.ref?.raw?.movementStrength.z ?? 0,
    zMovementSpeed: snow.ref?.raw?.movementSpeed.z ?? 0,
  };

  const snowFolderFields: FolderFields<typeof SNOW_PARAMS> = [
    {
      name: "opacity",
      params: {
        min: 0,
        max: 1,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            opacity: v.value,
          },
        });
      },
    },
    {
      name: "particleCount",
      params: {
        min: 0,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            particleCount: v.value,
          },
        });
      },
    },
    {
      name: "speed",
      params: {
        min: 0,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            speed: v.value,
          },
        });
      },
    },
    {
      name: "size",
      params: {
        min: 0,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            size: v.value,
          },
        });
      },
    },
    {
      name: "color",
      params: {
        color: {
          alpha: false,
          type: "int",
        },
      },
      onChange: (v) => {
        snow.update({
          snow: {
            color: v.value,
          },
        });
      },
    },
    {
      name: "areaWidth",
      params: {
        min: 100,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            areaWidth: v.value,
          },
        });
      },
    },
    {
      name: "areaHeight",
      params: {
        min: 100,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            areaHeight: v.value,
          },
        });
      },
    },
    {
      name: "maxHeight",
      params: {
        min: 100,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            maxHeight: v.value,
          },
        });
      },
    },
    {
      name: "xMovementStrength",
      params: {
        min: 0,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            movementStrength: {
              x: v.value,
              y: SNOW_PARAMS.yMovementStrength,
              z: SNOW_PARAMS.zMovementStrength,
            },
          },
        });
      },
    },
    {
      name: "xMovementSpeed",
      params: {
        min: 0,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            movementSpeed: {
              x: v.value,
              y: SNOW_PARAMS.yMovementSpeed,
              z: SNOW_PARAMS.zMovementSpeed,
            },
          },
        });
      },
    },
    {
      name: "yMovementStrength",
      params: {
        min: 0,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            movementStrength: {
              x: SNOW_PARAMS.xMovementStrength,
              y: v.value,
              z: SNOW_PARAMS.zMovementStrength,
            },
          },
        });
      },
    },
    {
      name: "yMovementSpeed",
      params: {
        min: 0,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            movementSpeed: {
              x: SNOW_PARAMS.xMovementSpeed,
              y: v.value,
              z: SNOW_PARAMS.zMovementSpeed,
            },
          },
        });
      },
    },
    {
      name: "zMovementStrength",
      params: {
        min: 0,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            movementStrength: {
              x: SNOW_PARAMS.xMovementStrength,
              y: SNOW_PARAMS.yMovementStrength,
              z: v.value,
            },
          },
        });
      },
    },
    {
      name: "zMovementSpeed",
      params: {
        min: 0,
      },
      onChange: (v) => {
        snow.update({
          snow: {
            movementSpeed: {
              x: SNOW_PARAMS.xMovementSpeed,
              y: SNOW_PARAMS.yMovementSpeed,
              z: v.value,
            },
          },
        });
      },
    },
  ];

  const snowFolder = pane.addFolder({
    title: "Snow",
  });
  addFieldsToFolder(snowFolder, SNOW_PARAMS, snowFolderFields);
};
