import ThreeView, {
  Color,
  degreeToRadian,
  geodeticToVector3,
} from "@navaramap/three";
import type {
  AerialPerspectiveLightingOptions,
  BoxMeshDesc,
  CloudsEffectDesc,
  SphereMeshDesc,
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
} from "../../../helpers/constants";
import {
  addCameraControl,
  addDateControl,
  addHidePaneKeyShortcut,
  atZoneDate,
} from "../../../helpers/control";

export type CustomDescriptions = DefaultDescriptions;

export const run = async (view: ThreeView<CustomDescriptions>) => {
  const plugin = new DefaultPlugin();
  view.addPlugin(plugin);
  const attribution = view.attribution;
  await view.init();

  view.setCamera({
    lng: 139.80779871102698,
    lat: 35.683761390118946,
    height: 524.2711987897646,
    heading: 267.9368996277385,
    pitch: -13.330033356703522,
    roll: 359.9999716638806,
  });

  view.toneMappingExposure = 10;

  const scene = plugin.addDefaultPhotorealScene();
  scene.sun.update({
    sun: {
      intensity: 1,
      castShadow: true,
    },
  });
  view.atmosphere.date = atZoneDate(view.atmosphere.date, {
    month: 4,
    date: 1,
    hours: 17,
    minutes: 20,
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
    // Vertex normals put the tiles on a Lambert material, which is what
    // writes the shadow buffer.
    source: terrainSource,
    terrain: { castShadow: true, receiveShadow: true },
  });
  const eox = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.eox.url,
    maxZoom: 15,
  });
  view.addLayer({ type: "raster", source: eox });

  const photo = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.gsiSeamlessphoto.url,
    maxZoom: 18,
    minZoom: 10,
  });
  view.addLayer({ type: "raster", source: photo });

  attribution?.add([
    TILE_DATASETS.eox,
    TILE_DATASETS.gsiSeamlessphoto,
    TERRAIN_DATASETS.reearthQuantizedMesh,
  ]);

  // Buildings give mutual occlusion and self-shadowing.
  const buildingSource = view.addSource({
    type: "3d-tiles",
    url: TILES_3D_DATASETS.plateauChiyoda.url,
  });
  // Metalness clears the specular reflectance threshold; glTF's default
  // roughness 1 is matte.
  const buildingLayerDescription = {
    type: "3d-tiles",
    source: buildingSource,
    model: {
      castShadow: true,
      receiveShadow: true,
      color: new Color().setStyle("#ffffff"),
      metalness: 0.5,
      roughness: 0.2,
    },
  } as const;
  const buildingLayer = view.addLayer(buildingLayerDescription);
  attribution?.add([TILES_3D_DATASETS.plateauChiyoda]);

  // Known shapes with a known shadow, to read the filter against.
  view.addMesh<BoxMeshDesc>({
    box: {
      width: 60,
      height: 240,
      depth: 60,
      color: new Color().setHex(0xdddddd),
      castShadow: true,
      receiveShadow: true,
    },
    position: geodeticToVector3({
      lat: degreeToRadian(35.684),
      lng: degreeToRadian(139.7625),
      height: 120,
    }),
  });
  view.addMesh<SphereMeshDesc>({
    sphere: {
      radius: 50,
      color: new Color().setHex(0x88bbff),
      castShadow: true,
      receiveShadow: true,
    },
    position: geodeticToVector3({
      lat: degreeToRadian(35.6832),
      lng: degreeToRadian(139.7618),
      height: 50,
    }),
  });

  const state = {
    irradiance: true,
    lit: false,
    albedoScale: 2 / Math.PI,
    exposure: 10,
    shadow: true,
    intensity: 1,
    softness: 1.5,
    samples: 12,
    specular: true,
    specularIntensity: 1,
    metalness: 0.5,
    roughness: 0.2,
    clouds: true,
    cloudCoverage: 0.25,
    cloudShadows: true,
    buffers: "",
  };

  // Deleted rather than hidden: disposing the effect is what clears its shadow
  // from the atmosphere, so a hidden cloud layer would keep darkening the
  // ground.
  let cloudsHandle: ReturnType<typeof view.addEffect<CloudsEffectDesc>> | null =
    null;
  const syncClouds = () => {
    if (state.clouds && !cloudsHandle) {
      cloudsHandle = view.addEffect<CloudsEffectDesc>({
        clouds: {
          qualityPreset: "high",
          coverage: state.cloudCoverage,
          shadows: state.cloudShadows,
          localWeatherVelocity: new Vector2(0.001, 0),
        },
      });
    } else if (!state.clouds && cloudsHandle) {
      cloudsHandle.delete();
      cloudsHandle = null;
    }
  };

  const updateLighting = (config: AerialPerspectiveLightingOptions) => {
    scene.aerialPerspective.update({ aerialPerspective: config });
  };

  const lightingOptions = (): AerialPerspectiveLightingOptions => ({
    shadowIntensity: state.intensity,
    shadowSoftness: state.softness,
    shadowSamples: state.samples,
    specularIntensity: state.specularIntensity,
  });

  const syncInfo = () => {
    state.buffers = JSON.stringify(view.buffers);
  };

  const pane = new Pane({ title: "Deferred lighting" });
  addHidePaneKeyShortcut(pane);

  addCameraControl(view, pane);
  addDateControl(view, pane, view.atmosphere.date);

  const lighting = pane.addFolder({ title: "Lighting" });
  lighting.addBinding(state, "irradiance").on("change", (ev) => {
    // Forward lighting must step aside or the scene is lit twice.
    scene.aerialPerspective.update({
      aerialPerspective: { irradiance: ev.value },
    });
    view.lit = !ev.value;
    state.lit = view.lit;
    pane.refresh();
  });
  lighting.addBinding(state, "lit").on("change", (ev) => {
    view.lit = ev.value;
  });
  lighting
    .addBinding(state, "albedoScale", { min: 0, max: 2, step: 0.01 })
    .on("change", (ev) => {
      scene.aerialPerspective.update({
        aerialPerspective: { albedoScale: ev.value },
      });
    });
  lighting
    .addBinding(state, "exposure", { min: 0.1, max: 20, step: 0.1 })
    .on("change", (ev) => {
      view.toneMappingExposure = ev.value;
    });

  const shadow = pane.addFolder({ title: "Shadow effect" });
  shadow.addBinding(state, "shadow").on("change", (ev) => {
    updateLighting({ shadow: ev.value });
    syncInfo();
  });
  shadow
    .addBinding(state, "intensity", { min: 0, max: 1, step: 0.01 })
    .on("change", (ev) => {
      updateLighting({ shadowIntensity: ev.value });
    });
  shadow
    .addBinding(state, "softness", { min: 0, max: 8, step: 0.1 })
    .on("change", (ev) => {
      updateLighting({ shadowSoftness: ev.value });
    });
  shadow
    .addBinding(state, "samples", { min: 1, max: 32, step: 1 })
    .on("change", (ev) => {
      updateLighting({ shadowSamples: ev.value });
    });

  const specular = pane.addFolder({ title: "Specular" });
  specular.addBinding(state, "specular").on("change", (ev) => {
    updateLighting({ specular: ev.value });
    syncInfo();
  });
  specular
    .addBinding(state, "specularIntensity", { min: 0, max: 4, step: 0.05 })
    .on("change", (ev) => {
      updateLighting({ specularIntensity: ev.value });
    });
  // Material properties, not effect options. Below metalness 0.01 the term
  // skips the surface.
  const updateBuildingMaterial = () => {
    buildingLayer.update({
      ...buildingLayerDescription,
      model: {
        ...buildingLayerDescription.model,
        metalness: state.metalness,
        roughness: state.roughness,
      },
    });
  };
  specular
    .addBinding(state, "metalness", { min: 0, max: 1, step: 0.01 })
    .on("change", updateBuildingMaterial);
  specular
    .addBinding(state, "roughness", { min: 0.02, max: 1, step: 0.01 })
    .on("change", updateBuildingMaterial);

  // Cloud shadows multiply the same sun irradiance as the terms above, so the
  // highlight and the shadowed ground should both dim under a cloud.
  const clouds = pane.addFolder({ title: "Clouds" });
  clouds.addBinding(state, "clouds").on("change", syncClouds);
  clouds
    .addBinding(state, "cloudCoverage", { min: 0, max: 1, step: 0.01 })
    .on("change", (ev) => {
      cloudsHandle?.update({ clouds: { coverage: ev.value } });
    });
  clouds.addBinding(state, "cloudShadows").on("change", (ev) => {
    cloudsHandle?.update({ clouds: { shadows: ev.value } });
  });

  const sun = pane.addFolder({ title: "Sun", expanded: false });
  const sunState = {
    shadowMapSize: 2048,
    shadowCascadeCount: 4,
    shadowFar: 4000,
    shadowBias: 0.0001,
    shadowNormalBias: 3,
    shadowIntensity: 1,
    shadowRadius: 1,
  };
  sun
    .addBinding(sunState, "shadowMapSize", {
      options: { 1024: 1024, 2048: 2048, 4096: 4096 },
    })
    .on("change", (ev) => {
      scene.sun.update({ sun: { shadowMapSize: ev.value } });
    });
  sun
    .addBinding(sunState, "shadowCascadeCount", { min: 1, max: 4, step: 1 })
    .on("change", (ev) => {
      scene.sun.update({ sun: { shadowCascadeCount: ev.value } });
    });
  sun
    .addBinding(sunState, "shadowFar", { min: 500, max: 50000, step: 100 })
    .on("change", (ev) => {
      scene.sun.update({ sun: { shadowFar: ev.value } });
    });
  sun
    .addBinding(sunState, "shadowBias", { min: -0.001, max: 0.001, step: 1e-5 })
    .on("change", (ev) => {
      scene.sun.update({ sun: { shadowBias: ev.value } });
    });
  sun
    .addBinding(sunState, "shadowNormalBias", { min: 0, max: 10, step: 0.1 })
    .on("change", (ev) => {
      scene.sun.update({ sun: { shadowNormalBias: ev.value } });
    });
  sun
    .addBinding(sunState, "shadowIntensity", { min: 0, max: 1, step: 0.01 })
    .on("change", (ev) => {
      scene.sun.update({ sun: { shadowIntensity: ev.value } });
    });
  // Shadow-map softness, the counterpart to the effect's screen-space one.
  sun
    .addBinding(sunState, "shadowRadius", { min: 1, max: 8, step: 0.25 })
    .on("change", (ev) => {
      scene.sun.update({ sun: { shadowRadius: ev.value } });
    });

  const info = pane.addFolder({ title: "Info", expanded: false });
  info.addBinding(state, "buffers", { readonly: true, interval: 500 });

  scene.aerialPerspective.update({
    aerialPerspective: { irradiance: state.irradiance },
  });
  view.lit = !state.irradiance;
  // Keeps the pane and the light in agreement.
  scene.sun.update({ sun: sunState });
  // Enabled via `update` to exercise the runtime-toggle path.
  updateLighting({
    shadow: state.shadow,
    specular: state.specular,
    ...lightingOptions(),
  });
  syncClouds();
  syncInfo();

  view.on("postUpdate", () => {
    state.buffers = JSON.stringify(view.buffers);
  });
};
