import ThreeView, { Color } from "@navaramap/three";
import type {
  CloudsEffectDesc,
  SSREffectDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Vector2 } from "three";

import { initializeExample } from "../../../../helpers/initialize";

const view = new ThreeView<DefaultDescriptions>({
  shadow: true,
  animation: true,
});

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);

await view.init();

const scene = defaultPlugin.addDefaultPhotorealScene({
  deferredLighting: true,
  shadow: true,
  specular: true,
});

scene.sun.update({
  sun: { castShadow: true, shadowFar: 4000, shadowLambda: 1 },
});

view.toneMappingExposure = 10;
view.atmosphere.date = new Date("2026-12-17T16:00:00+09:00");

view.setCamera({
  lng: 139.7868,
  lat: 35.6733,
  height: 130,
  heading: 238,
  pitch: -8,
  roll: 0,
});

const imagery = view.addSource({
  type: "raster-tile",
  url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
  maxZoom: 18,
});
view.addLayer({ type: "raster", source: imagery });

const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain",
  maxZoom: 18,
  requestVertexNormals: true,
  requestWaterMask: true,
});
view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { castShadow: true, receiveShadow: true },
});

const buildings = view.addSource({
  type: "3d-tiles",
  url: "https://assets.cms.plateau.reearth.io/assets/4c/f2436a-e2be-40e2-83da-f1781f36e30b/13102_chuo-ku_pref_2023_citygml_1_op_bldg_3dtiles_13102_chuo-ku_lod2_no_texture/tileset.json",
});
view.addLayer({
  type: "3d-tiles",
  source: buildings,
  model: {
    color: new Color().setStyle("#ffffff"),
    metalness: 0,
    roughness: 1,
    castShadow: true,
    receiveShadow: true,
  },
});

view.addEffect<CloudsEffectDesc>({
  clouds: {
    qualityPreset: "high",
    coverage: 0.3,
    localWeatherVelocity: new Vector2(0.005, 0),
    lightShafts: true,
    shadows: true,
    haze: true,
  },
});

view.addEffect<SSREffectDesc>({
  ssr: { iterations: 250, coneTracingMaxDistance: 2000 },
});

view.attribution?.add([
  {
    attribution: "© Re:Earth Terrain",
    attributionUrl: "https://terrain.reearth.land/",
  },
  {
    attribution:
      "Geospatial Information Authority of Japan Tiles - Latest Nationwide Photo (Seamless)",
    attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
  },
  {
    attribution:
      "3D City Model (Project PLATEAU) Chuo Ward (FY2023) - MLIT PLATEAU",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/plateau-13102-chuo-ku-2023",
  },
]);

initializeExample(view);
