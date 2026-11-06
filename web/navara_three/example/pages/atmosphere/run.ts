import ThreeView, {
  EventHandler,
  Color,
  type LayerDescription,
  MeshHandle,
  LightHandle,
  EffectHandle,
} from "@navaramap/three";
import {
  SunLightDesc,
  AmbientLightDesc,
  SkyLightProbeDesc,
  LightProbeDesc,
  SkyMeshDesc,
  StarsDesc,
  AerialPerspectiveEffectDesc,
  CloudsEffectDesc,
  SSAOEffectDesc,
  DEFAULT_CLOUDS_OPTIONS,
  ToneMappingMode,
  type CloudsOptions,
  type SSAOQualityMode,
  type TextureChannel,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { SphericalHarmonics3 } from "three";
import { Pane } from "tweakpane";

import {
  TERRAIN_DATASETS,
  TILE_DATASETS,
  TILES_3D_DATASETS,
  LOCAL_DATASETS,
} from "../../helpers/constants";
import {
  addCameraControl,
  addDateControl,
  addHidePaneKeyShortcut,
} from "../../helpers/control";
import {
  addFieldsToFolder,
  type FieldsApis,
  type FolderFields,
} from "../../helpers/panel";
import { SH_COEFFICIENTS } from "../../helpers/sh";

export type CustomDescriptions = DefaultDescriptions;

type DefaultEffects = ReturnType<DefaultPlugin["addDefaultPhotorealScene"]>;

export const run = async (view: ThreeView<CustomDescriptions>) => {
  const plugin = new DefaultPlugin();
  view.addPlugin(plugin);
  const attribution = view.attribution;
  await view.init();

  const defaultEffects = plugin.addDefaultPhotorealScene();

  defaultEffects.aerialPerspective.update({
    aerialPerspective: {
      sky: false,
    },
  });

  // Add clouds effect descriptor explicitly
  const cloudsLayer = view.addEffect<CloudsEffectDesc>({
    clouds: {},
  });

  // Cast to specific descriptor types for easier access and updates
  const skyLayer = defaultEffects.sky;
  const starsLayer = defaultEffects.stars;
  const sunLight = defaultEffects.sun;
  const skyLightProbeDesc = defaultEffects.skyLightProbe;

  sunLight.update({
    sun: {
      castShadow: true,
    },
  });

  // Add an additional ambient light descriptor
  const ambientLight: LightHandle<AmbientLightDesc> = view.addLight({
    visible: false,
    ambient: {
      intensity: 1,
      color: new Color().setStyle("#ffffff"),
    },
  });

  const terrainSource = view.addSource({
    type: "quantized-mesh",
    url: TERRAIN_DATASETS.reearthQuantizedMesh.url,
    maxZoom: 18,
    requestVertexNormals: true,
    requestWaterMask: true,
  });
  view.addLayer({
    type: "terrain",
    source: terrainSource,
    terrain: { castShadow: true, receiveShadow: true },
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
    },
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
      castShadow: true,
      receiveShadow: true,
    },
  });

  const pane = new Pane({
    title: "Parameters",
    expanded: true,
  });
  pane.element.style.maxHeight = "98vh";
  pane.element.style.overflow = "scroll";

  addHidePaneKeyShortcut(pane);

  addCameraControl(view, pane);
  const tileBinding = addTileControl(view, pane);
  addCloudsTilesControl(view, pane, tileBinding);
  addDateControl(view, pane);
  addAtmosphereControl(
    pane,
    skyLayer,
    starsLayer,
    sunLight,
    ambientLight,
    skyLightProbeDesc,
    defaultEffects.aerialPerspective,
  );
  addCloudsControl(view, pane, cloudsLayer);
  addAAControl(view, pane, defaultEffects);
  addIBLControl(view, pane);
  addEffectsControl(view, pane, defaultEffects);

  attribution?.add([
    TERRAIN_DATASETS.reearthQuantizedMesh,
    TILES_3D_DATASETS.plateauChiyoda,
    TILES_3D_DATASETS.plateauChuo,
    LOCAL_DATASETS.blueMarbleClouds,
  ]);
};

const addTileControl = (view: ThreeView<CustomDescriptions>, pane: Pane) => {
  const PARAMS = {
    type: TILE_DATASETS.gsiSeamlessphoto.url,
  };

  const createTileSource = (url: string) =>
    view.addSource({
      type: "raster-tile",
      url,
      maxZoom: 18,
      minZoom: 2,
    });

  let source = createTileSource(PARAMS.type);
  let layer = view.addLayer({
    type: "raster",
    source,
  });

  // Keep the credit in sync with the active base tile.
  const tileByUrl = (url: string) =>
    Object.values(TILE_DATASETS).find((t) => t.url === url);
  let tileCredit = tileByUrl(PARAMS.type);
  if (tileCredit) view.attribution?.add([tileCredit]);

  const folder = pane.addFolder({
    title: "RasterTile",
  });

  const tileChangeBinding = new EventHandler();

  folder
    .addBinding(PARAMS, "type", {
      options: Object.fromEntries(
        Object.entries(TILE_DATASETS).map(([key, value]) => [key, value.url]),
      ),
    })
    .on("change", (v) => {
      layer.delete();
      // The layer referencing this source is gone, so free the old source
      // before creating the replacement to avoid leaving an orphan behind.
      source.delete();
      source = createTileSource(v.value);
      layer = view.addLayer({
        type: "raster",
        source,
      });
      if (tileCredit) view.attribution?.remove([tileCredit]);
      tileCredit = tileByUrl(v.value);
      if (tileCredit) view.attribution?.add([tileCredit]);
      tileChangeBinding.emit("change");
    });

  return tileChangeBinding;
};

const addCloudsTilesControl = (
  view: ThreeView<CustomDescriptions>,
  pane: Pane,
  tileChangeBinding: EventHandler,
) => {
  const PARAMS = {
    show: true,
  };

  const cloudsTilesSource = view.addSource({
    type: "raster-tile",
    url: LOCAL_DATASETS.blueMarbleClouds.url,
    maxZoom: 6,
    minZoom: 2,
  });

  const description: LayerDescription = {
    type: "raster",
    source: cloudsTilesSource,
    raster: {},
  };

  let cloudsTilesLayer = view.addLayer(description);

  const folder = pane.addFolder({
    title: "CloudsTiles",
  });

  view.once("postUpdate", () => {
    const initialHeight = view.camera.positionGeographic.height;

    const transitionTile = () => {
      const position = view.camera.positionGeographic;
      if (!position?.height) return;

      const targetMaxHeight = initialHeight;
      const targetMinHeight = 10e5;
      const opacity = Math.min(
        1,
        (position.height - targetMinHeight) /
          (targetMaxHeight - targetMinHeight),
      );

      if (
        !description.raster ||
        (description.raster.opacity != null &&
          description.raster.opacity <= 0 &&
          opacity <= 0)
      )
        return;

      description.raster.opacity = opacity;
      cloudsTilesLayer.update(description);
    };

    view.camera.on("move", transitionTile);
    view.camera.on("moveend", transitionTile);
  });

  const fields: FolderFields<typeof PARAMS> = [
    {
      name: "show",
      onChange: (v) => {
        if (!description.raster) return;
        description.raster.show = v.value;
        cloudsTilesLayer.update(description);
      },
    },
  ];

  addFieldsToFolder(folder, PARAMS, fields);

  tileChangeBinding.on("change", () => {
    cloudsTilesLayer.delete();
    cloudsTilesLayer = view.addLayer(description);
  });
};

const addAtmosphereControl = (
  pane: Pane,
  skyLayer: MeshHandle<SkyMeshDesc>,
  starsLayer: MeshHandle<StarsDesc>,
  sunLight: LightHandle<SunLightDesc>,
  ambientLight: LightHandle<AmbientLightDesc>,
  _skyLightProbeDesc: LightHandle<SkyLightProbeDesc>,
  aerialPerspectiveLayer: EffectHandle<AerialPerspectiveEffectDesc>,
) => {
  const PARAMS = {
    aerialPerspective: true,
    sky: true,
    sun: true,
    moon: true,
    stars: true,
    sunLight: true,
    sunLightColor: 0xffffff,
    sunApplyLightColor: false,
    sunLightIntensity: 1,
    moonScale: 1,
    moonIntensity: 1,
    starsPointSize: 1,
    starsRadianceScale: 10,
    ambientLight: false,
    ambientLightColor: 0xffffff,
    ambientLightIntensity: 1,
    inscatter: true,
    transmittance: true,
    irradiance: false,
  };

  const folder = pane.addFolder({
    title: "Atmosphere",
  });

  folder.addBinding(PARAMS, "aerialPerspective").on("change", (v) => {
    aerialPerspectiveLayer.update({
      visible: v.value,
    });
  });
  folder.addBinding(PARAMS, "sky").on("change", (v) => {
    skyLayer.visible = v.value;
  });
  folder.addBinding(PARAMS, "sun").on("change", (v) => {
    skyLayer.update({ sky: { sun: v.value } });
  });
  folder.addBinding(PARAMS, "moon").on("change", (v) => {
    skyLayer.update({ sky: { moon: v.value } });
  });
  folder.addBinding(PARAMS, "stars").on("change", (v) => {
    starsLayer.visible = v.value;
  });
  folder.addBinding(PARAMS, "sunLight").on("change", (v) => {
    sunLight.visible = v.value;
  });
  folder
    .addBinding(PARAMS, "sunLightColor", { color: { type: "int" } })
    .on("change", (v) => {
      sunLight.update({
        sun: { color: new Color().setHex(v.value) },
      });
    });
  folder.addBinding(PARAMS, "sunApplyLightColor").on("change", (v) => {
    sunLight.update({ sun: { applyColor: v.value } });
  });
  folder.addBinding(PARAMS, "moonScale").on("change", (v) => {
    skyLayer.update({ sky: { moonScale: v.value } });
  });
  folder.addBinding(PARAMS, "moonIntensity").on("change", (v) => {
    skyLayer.update({ sky: { moonIntensity: v.value } });
  });
  folder.addBinding(PARAMS, "starsPointSize").on("change", (v) => {
    starsLayer.update({ stars: { pointSize: v.value } });
  });
  folder.addBinding(PARAMS, "starsRadianceScale").on("change", (v) => {
    starsLayer.update({ stars: { intensity: v.value } });
  });
  folder.addBinding(PARAMS, "sunLightIntensity").on("change", (v) => {
    sunLight.update({ sun: { intensity: v.value } });
  });
  folder.addBinding(PARAMS, "ambientLight").on("change", (v) => {
    ambientLight.visible = v.value;
  });
  folder
    .addBinding(PARAMS, "ambientLightColor", { color: { type: "int" } })
    .on("change", (v) => {
      ambientLight.update({
        ambient: { color: new Color().setHex(v.value) },
      });
    });
  folder.addBinding(PARAMS, "ambientLightIntensity").on("change", (v) => {
    ambientLight.update({ ambient: { intensity: v.value } });
  });
  folder.addBinding(PARAMS, "inscatter").on("change", (v) => {
    aerialPerspectiveLayer.update({
      aerialPerspective: {
        inscatter: v.value,
      },
    });
  });
  folder.addBinding(PARAMS, "transmittance").on("change", (v) => {
    aerialPerspectiveLayer.update({
      aerialPerspective: {
        transmittance: v.value,
      },
    });
  });
  folder.addBinding(PARAMS, "irradiance").on("change", (v) => {
    aerialPerspectiveLayer.update({
      aerialPerspective: {
        irradiance: v.value,
      },
    });
  });
};

const addCloudsControl = (
  view: ThreeView<CustomDescriptions>,
  pane: Pane,
  cloudsLayerHandle: EffectHandle<CloudsEffectDesc>,
) => {
  const BASE_PARAMS = {
    enable: true,
    coverage: DEFAULT_CLOUDS_OPTIONS.coverage,
    qualityPreset: DEFAULT_CLOUDS_OPTIONS.qualityPreset,
    animation: false,
    lightShafts: !!DEFAULT_CLOUDS_OPTIONS.lightShafts,

    // Processing
    resolutionScale: DEFAULT_CLOUDS_OPTIONS.resolutionScale,
    maxIterationCount: 50,
    minStepSize: 100,
    maxStepSize: 1000,
  };
  const SHADOW_PARAMS = {
    shadows: DEFAULT_CLOUDS_OPTIONS.shadows,
    // The default "medium" quality preset's shadow map.
    shadowCascadeCount: 3,
    shadowMapSize: 256,
  };
  const HAZE_PARAMS = {
    haze: DEFAULT_CLOUDS_OPTIONS.haze,
    hazeDensityScale: DEFAULT_CLOUDS_OPTIONS.hazeDensityScale,
    hazeExponent: DEFAULT_CLOUDS_OPTIONS.hazeExponent,
    hazeScatteringCoefficient: DEFAULT_CLOUDS_OPTIONS.hazeScatteringCoefficient,
    hazeAbsorptionCoefficient: DEFAULT_CLOUDS_OPTIONS.hazeAbsorptionCoefficient,
  };
  const WEATHER_AND_SHAPE_PARAMS = {
    localWeatherRepeat: DEFAULT_CLOUDS_OPTIONS.localWeatherRepeat.x,
    localWeatherOffset: DEFAULT_CLOUDS_OPTIONS.localWeatherOffset,
    shapeRepeat: DEFAULT_CLOUDS_OPTIONS.shapeRepeat.x,
    shapeOffset: DEFAULT_CLOUDS_OPTIONS.shapeOffset,
    shapeDetailRepeat: DEFAULT_CLOUDS_OPTIONS.shapeDetailRepeat.x,
    shapeDetailOffset: DEFAULT_CLOUDS_OPTIONS.shapeDetailOffset,
    turbulenceRepeat: DEFAULT_CLOUDS_OPTIONS.turbulenceRepeat.x,
    turbulenceDisplacement: DEFAULT_CLOUDS_OPTIONS.turbulenceDisplacement,
  };
  const SCATTERING_PARAMS = {
    scatteringCoefficient: DEFAULT_CLOUDS_OPTIONS.scatteringCoefficient,
    absorptionCoefficient: DEFAULT_CLOUDS_OPTIONS.absorptionCoefficient,
    scatterAnisotropy1: DEFAULT_CLOUDS_OPTIONS.scatterAnisotropy1,
    scatterAnisotropy2: DEFAULT_CLOUDS_OPTIONS.scatterAnisotropy2,
    scatterAnisotropyMix: DEFAULT_CLOUDS_OPTIONS.scatterAnisotropyMix,
    skyLightScale: DEFAULT_CLOUDS_OPTIONS.skyLightScale,
    groundBounceScale: DEFAULT_CLOUDS_OPTIONS.groundBounceScale,
    powderScale: DEFAULT_CLOUDS_OPTIONS.powderScale,
    powderExponent: DEFAULT_CLOUDS_OPTIONS.powderExponent,
  };
  const CLOUD_LAYERS_PARAMS = {
    index: 0,
    channel: "r",
    altitude: 0,
    height: 0,
    densityScale: 0,
    shapeAmount: 0,
    shapeDetailAmount: 0,
    weatherExponent: 0,
    shapeAlteringBias: 0,
    coverageFilterWidth: 0,
    shadow: false,
    expTerm: 0,
    exponent: 0,
    linearTerm: 0,
    constantTerm: 0,
  };

  const cloudsLayer = cloudsLayerHandle.ref.raw;

  const baseFields: FolderFields<typeof BASE_PARAMS> = [
    {
      name: "enable",
      onChange: (v) => {
        if (!cloudsLayer) return;
        if (v.value) {
          cloudsLayer.coverage = BASE_PARAMS.coverage;
        } else {
          cloudsLayer.coverage = 0;
        }
      },
    },
    {
      name: "coverage",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.coverage = v.value;
      },
    },
    {
      name: "qualityPreset",
      params: {
        options: Object.fromEntries(
          ["ultra", "high", "medium", "low"].map((v) => [v, v]),
        ),
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.qualityPreset =
          v.value as Required<CloudsOptions>["qualityPreset"];
      },
    },
    {
      name: "animation",
      onChange: (v) => {
        if (cloudsLayer) {
          cloudsLayer.localWeatherVelocity.x = v.value ? 0.001 : 0;
          view.forceUpdate();
        }
        view.animation = v.value;
      },
    },
    {
      name: "lightShafts",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.lightShafts = v.value;
      },
    },

    // Processing
    {
      name: "resolutionScale",
      params: {
        options: [1, 0.5, 0.25].map((v) => ({ text: v.toString(), value: v })),
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.resolutionScale = v.value;
      },
    },
    {
      name: "maxIterationCount",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.maxIterationCount = v.value;
      },
    },
    {
      name: "minStepSize",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.minStepSize = v.value;
      },
    },
    {
      name: "maxStepSize",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.maxStepSize = v.value;
      },
    },
  ];
  const shadowFields: FolderFields<typeof SHADOW_PARAMS> = [
    // Shadow
    {
      name: "shadows",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.shadows = v.value;
      },
    },
    {
      name: "shadowCascadeCount",
      params: {
        options: Object.fromEntries(
          [...new Array(4)].map((_, i) => [`${i + 1}`, i + 1]),
        ),
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.shadowCascadeCount = v.value;
      },
    },
    {
      name: "shadowMapSize",
      params: {
        options: {
          "128": 128,
          "256": 256,
          "512": 512,
          "1024": 1024,
        },
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.shadowMapSize.set(v.value, v.value);
        view.forceUpdate();
      },
    },
  ];
  const hazeFields: FolderFields<typeof HAZE_PARAMS> = [
    // Haze
    {
      name: "haze",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.haze = v.value;
      },
    },
    {
      name: "hazeDensityScale",
      params: {
        min: 0,
        step: 3e-5,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.hazeDensityScale = v.value;
      },
    },
    {
      name: "hazeExponent",
      params: {
        min: 0,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.hazeExponent = v.value;
      },
    },
    {
      name: "hazeScatteringCoefficient",
      params: {
        min: 0,
        max: 5,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.hazeScatteringCoefficient = v.value;
      },
    },
    {
      name: "hazeAbsorptionCoefficient",
      params: {
        min: 0,
        max: 5,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.hazeAbsorptionCoefficient = v.value;
      },
    },
  ];

  const weatherAndShapeFields: FolderFields<typeof WEATHER_AND_SHAPE_PARAMS> = [
    // Weather and shape
    {
      name: "localWeatherRepeat",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.localWeatherRepeat.setScalar(v.value);
        view.forceUpdate();
      },
    },
    {
      name: "localWeatherOffset",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.localWeatherOffset = v.value;
      },
    },
    {
      name: "shapeRepeat",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.shapeRepeat.setScalar(v.value);
        view.forceUpdate();
      },
    },
    {
      name: "shapeOffset",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.shapeOffset = v.value;
      },
    },
    {
      name: "shapeDetailRepeat",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.shapeDetailRepeat.setScalar(v.value);
        view.forceUpdate();
      },
    },
    {
      name: "shapeDetailOffset",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.shapeDetailOffset = v.value;
      },
    },
    {
      name: "turbulenceRepeat",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.turbulenceRepeat.setScalar(v.value);
        view.forceUpdate();
      },
    },
    {
      name: "turbulenceDisplacement",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.turbulenceDisplacement = v.value;
      },
    },
  ];
  const scatteringFields: FolderFields<typeof SCATTERING_PARAMS> = [
    // Scattering
    {
      name: "scatteringCoefficient",
      params: {
        min: 0,
        max: 5,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.scatteringCoefficient = v.value;
      },
    },
    {
      name: "absorptionCoefficient",
      params: {
        min: 0,
        max: 5,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.absorptionCoefficient = v.value;
      },
    },
    {
      name: "scatterAnisotropy1",
      params: {
        min: 0,
        max: 1,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.scatterAnisotropy1 = v.value;
      },
    },
    {
      name: "scatterAnisotropy2",
      params: {
        min: -1,
        max: 0,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.scatterAnisotropy2 = v.value;
      },
    },
    {
      name: "scatterAnisotropyMix",
      params: {
        min: 0,
        max: 1,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.scatterAnisotropyMix = v.value;
      },
    },
    {
      name: "skyLightScale",
      params: {
        min: 0,
        max: 5,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.skyLightScale = v.value;
      },
    },
    {
      name: "groundBounceScale",
      params: {
        min: 0,
        max: 10,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.groundBounceScale = v.value;
      },
    },
    {
      name: "powderScale",
      params: {
        min: 0,
        max: 1,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.powderScale = v.value;
      },
    },
    {
      name: "powderExponent",
      params: {
        min: 1,
        max: 1000,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.powderExponent = v.value;
      },
    },
  ];

  const onChangeCloudLayerIndex = (
    idx: number,
    apis: FieldsApis<typeof CLOUD_LAYERS_PARAMS>,
  ) => {
    if (!cloudsLayer) return;
    const layer = cloudsLayer.cloudLayers[idx];
    apis.channel.controller.value.rawValue = layer.channel;
    apis.altitude.controller.value.rawValue = layer.altitude;
    apis.height.controller.value.rawValue = layer.height;
    apis.densityScale.controller.value.rawValue = layer.densityScale;
    apis.shapeAmount.controller.value.rawValue = layer.shapeAmount;
    apis.shapeDetailAmount.controller.value.rawValue = layer.shapeDetailAmount;
    apis.weatherExponent.controller.value.rawValue = layer.weatherExponent;
    apis.shapeAlteringBias.controller.value.rawValue = layer.shapeAlteringBias;
    apis.coverageFilterWidth.controller.value.rawValue =
      layer.coverageFilterWidth;
    apis.shadow.controller.value.rawValue = layer.shadow;
    apis.expTerm.controller.value.rawValue = layer.expTerm;
    apis.exponent.controller.value.rawValue = layer.exponent;
    apis.linearTerm.controller.value.rawValue = layer.linearTerm;
    apis.constantTerm.controller.value.rawValue = layer.constantTerm;
  };
  const cloudLayersFields: FolderFields<typeof CLOUD_LAYERS_PARAMS> = [
    // Scattering
    {
      name: "index",
      params: {
        options: [0, 1, 2, 3].map((v) => ({ text: `${v}`, value: v })),
      },
      onMount: (apis) =>
        onChangeCloudLayerIndex(CLOUD_LAYERS_PARAMS.index, apis),
      onChange: (v, apis) => onChangeCloudLayerIndex(v.value, apis),
    },
    {
      name: "channel",
      params: {
        options: ["r", "g", "b", "a"].map((v) => ({ text: v, value: v })),
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].channel =
          v.value as TextureChannel;
      },
    },
    {
      name: "altitude",
      params: {
        step: 20,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].altitude = v.value;
      },
    },
    {
      name: "height",
      params: {
        step: 20,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].height = v.value;
      },
    },
    {
      name: "densityScale",
      params: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].densityScale =
          v.value;
      },
    },
    {
      name: "shapeAmount",
      params: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].shapeAmount =
          v.value;
      },
    },
    {
      name: "shapeDetailAmount",
      params: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].shapeDetailAmount =
          v.value;
      },
    },
    {
      name: "weatherExponent",
      params: {
        min: 0,
        max: 3,
        step: 0.01,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].weatherExponent =
          v.value;
      },
    },
    {
      name: "shapeAlteringBias",
      params: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].shapeAlteringBias =
          v.value;
      },
    },
    {
      name: "coverageFilterWidth",
      params: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].coverageFilterWidth =
          v.value;
      },
    },
    {
      name: "shadow",
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].shadow = v.value;
      },
    },
    {
      name: "expTerm",
      params: {
        min: 0,
        max: 1,
        step: 0.01,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].expTerm = v.value;
      },
    },
    {
      name: "exponent",
      params: {
        min: 0,
        max: 10,
        step: 0.02,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].exponent = v.value;
      },
    },
    {
      name: "linearTerm",
      params: {
        min: -2,
        max: 2,
        step: 0.01,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].linearTerm = v.value;
      },
    },
    {
      name: "constantTerm",
      params: {
        min: -2,
        max: 2,
        step: 0.01,
      },
      onChange: (v) => {
        if (!cloudsLayer) return;
        cloudsLayer.cloudLayers[CLOUD_LAYERS_PARAMS.index].constantTerm =
          v.value;
      },
    },
  ];

  const folder = pane.addFolder({
    title: "Clouds",
  });

  addFieldsToFolder(folder, BASE_PARAMS, baseFields);
  addFieldsToFolder(
    folder.addFolder({ title: "Shadow", expanded: false }),
    SHADOW_PARAMS,
    shadowFields,
  );
  addFieldsToFolder(
    folder.addFolder({ title: "Haze", expanded: false }),
    HAZE_PARAMS,
    hazeFields,
  );
  addFieldsToFolder(
    folder.addFolder({ title: "Weather and shape", expanded: false }),
    WEATHER_AND_SHAPE_PARAMS,
    weatherAndShapeFields,
  );
  addFieldsToFolder(
    folder.addFolder({ title: "Scattering", expanded: false }),
    SCATTERING_PARAMS,
    scatteringFields,
  );
  addFieldsToFolder(
    folder.addFolder({ title: "Cloud layers", expanded: false }),
    CLOUD_LAYERS_PARAMS,
    cloudLayersFields,
  );
};

const addAAControl = (
  view: ThreeView<CustomDescriptions>,
  pane: Pane,
  defaultEffects: DefaultEffects,
) => {
  // Determine the current AA effect type based on view's mobile optimization setting
  const currentEffect = view.isMobileOptimized() ? "fxaa" : "smaa";

  const PARAMS = {
    enable: false,
    // Show user what AA is actually being used (read-only info)
    effect: currentEffect as "smaa" | "fxaa",
    quality: "medium" as "ultra" | "high" | "medium" | "low",
    // edgeDetectionMode is only applicable to SMAA
    edgeDetectionMode: "color" as "depth" | "luma" | "color",
  };

  // Initialize with current settings - only apply relevant options per effect type
  if (currentEffect === "smaa") {
    defaultEffects.antialiasing.update({
      visible: PARAMS.enable,
      smaa: {
        quality: PARAMS.quality,
        edgeDetectionMode: PARAMS.edgeDetectionMode,
      },
    });
  } else {
    defaultEffects.antialiasing.update({
      visible: PARAMS.enable,
      fxaa: {},
    });
  }

  const folder = pane.addFolder({
    title: "Antialias",
  });

  folder.addBinding(PARAMS, "enable").on("change", (v) => {
    defaultEffects.antialiasing.update({ visible: v.value });
  });

  // Effect type is determined by device - show as read-only info
  folder.addBinding(PARAMS, "effect", {
    readonly: true,
    label: "effect (auto)",
  });

  // Quality setting - applicable to SMAA only
  folder
    .addBinding(PARAMS, "quality", {
      options: Object.fromEntries(
        ["ultra", "high", "medium", "low"].map((k) => [k, k]),
      ),
      disabled: currentEffect === "fxaa",
      label: currentEffect === "fxaa" ? "quality (n/a)" : "quality",
    })
    .on("change", (v) => {
      if (currentEffect === "smaa") {
        defaultEffects.antialiasing.update({
          smaa: { quality: v.value },
        });
      }
    });

  // Edge detection mode - SMAA specific, not applicable to FXAA
  folder
    .addBinding(PARAMS, "edgeDetectionMode", {
      options: Object.fromEntries(
        ["depth", "luma", "color"].map((k) => [k, k]),
      ),
      disabled: currentEffect === "fxaa",
      label: currentEffect === "fxaa" ? "edgeMode (n/a)" : "edgeDetectionMode",
    })
    .on("change", (v) => {
      if (currentEffect === "smaa") {
        defaultEffects.antialiasing.update({
          smaa: { edgeDetectionMode: v.value },
        });
      }
    });

  // Add tooltip/info for FXAA users
  if (currentEffect === "fxaa") {
    folder.addBlade({
      view: "text",
      label: "info",
      parse: (v: string) => v,
      value: "FXAA used on mobile for performance",
    });
  }
};

// Advanced
const addIBLControl = (view: ThreeView<CustomDescriptions>, pane: Pane) => {
  const PARAMS = {
    enable: false,
    sh: "debug",
    intensity: 1,
  };

  const sh = new SphericalHarmonics3();
  sh.coefficients = SH_COEFFICIENTS.debug;

  // Create the light probe layer but keep it hidden initially
  const lightProbeLayer = view.addLight<LightProbeDesc>({
    lightProbe: {
      sh: sh,
      intensity: PARAMS.intensity,
    },
    visible: false,
  });

  const folder = pane.addFolder({
    title: "Image-based lighting",
  });

  folder.addBinding(PARAMS, "enable").on("change", (v) => {
    lightProbeLayer.update({
      visible: v.value,
    });
    view.forceUpdate();
  });
  folder
    .addBinding(PARAMS, "sh", {
      options: Object.fromEntries(
        Object.entries(SH_COEFFICIENTS).map(([k]) => [k, k]),
      ),
    })
    .on("change", (v) => {
      sh.coefficients =
        SH_COEFFICIENTS[v.value as keyof typeof SH_COEFFICIENTS];
      lightProbeLayer.update({
        lightProbe: {
          sh: sh,
        },
      });
      view.forceUpdate();
    });
  folder.addBinding(PARAMS, "intensity").on("change", (v) => {
    lightProbeLayer.update({
      lightProbe: {
        intensity: v.value,
      },
    });
    view.forceUpdate();
  });
};

const addEffectsControl = (
  view: ThreeView<CustomDescriptions>,
  pane: Pane,
  defaultEffects: DefaultEffects,
) => {
  const PARAMS = {
    toneMapping: true,
    toneMappingMode: ToneMappingMode.AGX,
    toneMappingExposure: 10,
    lensFlare: true,
    lensFlareIntensity: 0.005,
    dithering: true,
    ssao: false,
    ssaoHalfRes: true,
    ssaoQuality: "Low",
    ssaoSamples: 16,
    ssaoRadius: 5,
    ssaoIntensity: 1,
    ssaoColor: "#000000",
  };

  defaultEffects.toneMapping.update({
    visible: PARAMS.toneMapping,
    toneMapping: { mode: PARAMS.toneMappingMode },
  });
  view.toneMappingExposure = PARAMS.toneMappingExposure;
  defaultEffects.lensFlare?.update({
    visible: PARAMS.lensFlare,
    lensFlare: { intensity: PARAMS.lensFlareIntensity },
  });

  const ssao = view.addEffect<SSAOEffectDesc>({
    visible: PARAMS.ssao,
    ssao: {},
  });

  const folder = pane.addFolder({
    title: "Effects",
  });

  folder.addBinding(PARAMS, "toneMapping").on("change", (v) => {
    defaultEffects.toneMapping.update({ visible: v.value });
  });
  folder
    .addBinding(PARAMS, "toneMappingMode", {
      options: ToneMappingMode,
    })
    .on("change", (v) => {
      defaultEffects.toneMapping.update({
        toneMapping: { mode: Number(v.value) },
      });
    });
  folder
    .addBinding(PARAMS, "toneMappingExposure", { min: 0, max: 20, steps: 1 })
    .on("change", (v) => {
      view.toneMappingExposure = v.value;
    });
  folder.addBinding(PARAMS, "lensFlare").on("change", (v) => {
    defaultEffects.lensFlare?.update({ visible: v.value });
  });
  folder
    .addBinding(PARAMS, "lensFlareIntensity", { step: 0.001 })
    .on("change", (v) => {
      defaultEffects.lensFlare?.update({ lensFlare: { intensity: v.value } });
    });
  folder.addBinding(PARAMS, "ssao").on("change", (v) => {
    ssao.update({ visible: v.value });
  });
  folder.addBinding(PARAMS, "ssaoHalfRes").on("change", (v) => {
    ssao.update({ ssao: { halfRes: v.value } });
  });
  folder
    .addBinding(PARAMS, "ssaoQuality", {
      options: ["Ultra", "High", "Medium", "Low"].map((v) => ({
        text: v,
        value: v,
      })),
    })
    .on("change", (v) => {
      ssao.update({
        ssao: { quality: v.value as SSAOQualityMode },
      });
    });
  folder.addBinding(PARAMS, "ssaoSamples").on("change", (v) => {
    ssao.update({ ssao: { samples: v.value } });
  });
  folder.addBinding(PARAMS, "ssaoRadius").on("change", (v) => {
    ssao.update({ ssao: { radius: v.value } });
  });
  folder.addBinding(PARAMS, "ssaoIntensity").on("change", (v) => {
    ssao.update({ ssao: { intensity: v.value } });
  });
  folder.addBinding(PARAMS, "ssaoColor").on("change", (v) => {
    ssao.update({ ssao: { color: new Color().setStyle(v.value) } });
  });
};
