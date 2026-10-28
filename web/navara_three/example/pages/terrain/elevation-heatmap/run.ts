import ThreeView, {
  TERRARIUM_ELEVATION_DECODER,
  Color,
  type LayerDescription,
} from "@navaramap/three";
import { ToneMappingMode } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { SphericalHarmonics3 } from "three";
import { Pane } from "tweakpane";

import {
  PLATEAU_COLOR_MAP,
  TURBO_COLOR_MAP,
  PLASMA_COLORMAP,
  YlGnBu_COLOR_MAP,
} from "../../../helpers/colors";
import { TERRAIN_DATASETS } from "../../../helpers/constants";
import { addCameraControl, addDateControl } from "../../../helpers/control";
import { SH_COEFFICIENTS } from "../../../helpers/sh";

export type CustomDescriptions = DefaultDescriptions;

export const run = async (view: ThreeView<CustomDescriptions>) => {
  view.addPlugin(new DefaultPlugin());

  const attribution = view.attribution;

  await view.init();

  view.addLight({ ambient: {} });

  view.toneMappingExposure = 3;

  view.addEffect({
    toneMapping: {
      mode: ToneMappingMode.REINHARD2,
    },
  });

  view.addLight({
    lightProbe: {
      sh: new SphericalHarmonics3().set(SH_COEFFICIENTS.white),
      intensity: 1,
    },
  });

  const demRaster = view.addSource({
    type: "raster-dem",
    url: TERRAIN_DATASETS.mapterhorn.url,
    elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
    tileSize: 512,
    maxZoom: 17,
    minZoom: 0,
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

  // Elevation heatmap from the same DEM, applied via a raster layer.
  const layerDef: LayerDescription = {
    type: "raster",
    source: demRaster.id,
    elevationHeatmap: {
      colorMap: PLATEAU_COLOR_MAP.flatten(),
      maxHeight: 3000,
      minHeight: 0,
      logarithmic: true,
      logBoundary: 1000,
    },
  };

  // Add elevation heatmap as a raster tile layer
  // This will use the terrain DEM data and apply color mapping
  const layerInst = view.addLayer(layerDef);

  view.setCamera({
    lng: 138.5,
    lat: 34,
    height: 100000,
    heading: 0,
    pitch: -30,
    roll: 0,
  });

  // Create control panel
  const pane = new Pane();
  addDateControl(view, pane);
  addCameraControl(view, pane);
  attribution?.add([
    TERRAIN_DATASETS.mapterhorn,
    TERRAIN_DATASETS.reearthQuantizedMesh,
  ]);

  const params = {
    color_map: "plateau",
    max_height: 3000,
    min_height: 0,
    logarithmic: true,
    log_boundary: 1000,
  };

  view.globe.color = new Color().setStyle("#9481ad");

  const changeFunc = () => {
    if (!layerDef.elevationHeatmap) {
      return;
    }
    layerDef.elevationHeatmap.maxHeight = params.max_height;
    layerDef.elevationHeatmap.minHeight = params.min_height;
    layerDef.elevationHeatmap.logarithmic = params.logarithmic;
    layerDef.elevationHeatmap.logBoundary = params.log_boundary;

    if (params.color_map === "plateau") {
      layerDef.elevationHeatmap.colorMap = PLATEAU_COLOR_MAP.flatten();
      view.globe.color = new Color().setStyle("#9481ad");
    } else if (params.color_map === "turbo") {
      layerDef.elevationHeatmap.colorMap = TURBO_COLOR_MAP.flatten();
      view.globe.color = new Color().setStyle("#784986");
    } else if (params.color_map === "plasma") {
      layerDef.elevationHeatmap.colorMap = PLASMA_COLORMAP.flatten();
      view.globe.color = new Color().setStyle("#7a4a91");
    } else if (params.color_map === "YlGnBu") {
      layerDef.elevationHeatmap.colorMap = YlGnBu_COLOR_MAP.flatten();
      view.globe.color = new Color().setStyle("#506b73");
    }
    view.updateLayerById(layerInst.id, layerDef);
  };

  const folder = pane.addFolder({
    title: "Elevation Heatmap",
  });

  folder
    .addBinding(params, "color_map", {
      options: {
        plateau: "plateau",
        turbo: "turbo",
        plasma: "plasma",
        YlGnBu: "YlGnBu",
      },
    })
    .on("change", changeFunc);
  folder.addBinding(params, "max_height").on("change", changeFunc);
  folder.addBinding(params, "min_height").on("change", changeFunc);
  folder.addBinding(params, "logarithmic").on("change", changeFunc);
  folder
    .addBinding(params, "log_boundary", { min: 0 })
    .on("change", changeFunc);
};
