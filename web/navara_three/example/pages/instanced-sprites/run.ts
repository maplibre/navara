import ThreeView, { Color } from "@navaramap/three";
import { AmbientLightDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { withBase } from "../../helpers/base";
import { TILE_DATASETS, VECTOR_DATASETS } from "../../helpers/constants";
import { addCameraControl, addDateControl } from "../../helpers/control";
import { addCtrlPanel, type MaterialDesc } from "../../helpers/panel";

const createLayers = (view: ThreeView<DefaultDescriptions>): MaterialDesc[] => {
  // Each feature is a MultiPoint: per-feature evaluation (the `image`
  // override below) must fan out to every instance of the feature, so all
  // markers of one feature show the same icon.
  const poiSource = view.addSource({
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { icon: "restaurant" },
          geometry: {
            coordinates: [
              [139.70513431449842, 35.69279782617761],
              [139.7551, 35.7528],
              [139.6512, 35.6314],
            ],
            type: "MultiPoint",
          },
        },
        {
          type: "Feature",
          properties: { icon: "cafe" },
          geometry: {
            coordinates: [
              [140.13033810546995, 35.60447056434825],
              [140.1923, 35.6641],
            ],
            type: "MultiPoint",
          },
        },
        {
          type: "Feature",
          properties: { icon: "hotel" },
          geometry: {
            coordinates: [
              [139.64591330307843, 35.85950281451436],
              [139.7204, 35.9132],
            ],
            type: "MultiPoint",
          },
        },
        {
          type: "Feature",
          properties: { icon: "school" },
          geometry: {
            coordinates: [
              [139.63564871528018, 35.44128807202607],
              [139.7028, 35.5009],
            ],
            type: "MultiPoint",
          },
        },
        {
          type: "Feature",
          properties: { icon: "hospital" },
          geometry: {
            coordinates: [
              [139.28453080888477, 35.51560883529815],
              [139.3517, 35.5723],
              [139.2109, 35.4607],
            ],
            type: "MultiPoint",
          },
        },
      ],
    },
  });
  const vectorSource = view.addSource({
    type: "vector-tile",
    url: VECTOR_DATASETS.gsiExperimentalVector.url,
    maxZoom: 6,
  });

  return [
    {
      type: "vector",
      source: poiSource,
      billboard: {
        color: new Color().setStyle("#ffffff"),
        size: 10000,
        height: 1,
        sizeInMeters: true,
        clampToGround: true,
        depthTest: true,
        alphaTest: 0.5,
        anchor: "bottom",
        transparent: true,
        url: withBase("example.png"),
        offsetDepth: true,
      },
    },
    {
      type: "vector",
      source: vectorSource,
      point: {
        size: 10000,
        sizeInMeters: true,
        clampToGround: true,
        color: new Color().setStyle("#991f3d"),
        height: 1,
        offsetDepth: true,
        depthTest: true,
        transparent: true,
      },
    },
  ];
};

export const run = async (view: ThreeView<DefaultDescriptions>) => {
  view.addPlugin(new DefaultPlugin());
  const attribution = view.attribution;

  await view.init();

  attribution?.add([
    VECTOR_DATASETS.gsiExperimentalVector,
    TILE_DATASETS.openstreetmap,
  ]);

  view.addLight<AmbientLightDesc>({
    ambient: {
      intensity: 0.5,
    },
  });

  const osmSource = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 23,
  });
  view.addLayer({
    type: "raster",
    source: osmSource,
  });

  view.setCamera({
    lng: 133.4791459306,
    lat: 32.8411214823,
    height: 320413.04,
    heading: 50.2271850895,
    pitch: -39.5339635139,
    roll: 360,
  });

  const pane = new Pane({
    title: "Parameters",
    expanded: true,
  });

  const layers = createLayers(view);
  const layerInstances = addCtrlPanel(layers, view, pane);
  addCameraControl(view, pane);
  addDateControl(view, pane);

  // Per-feature billboard images: each feature's `icon` property picks an
  // image URL. Every distinct URL is loaded once and packed into the layer's
  // texture atlas. `image: null` reverts to the material's `url`, so features
  // whose `icon` is removed fall back to the default instead of keeping a
  // stale override.
  const [billboardLayer] = layerInstances.values();
  billboardLayer?.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        const icon = properties?.["icon"] as string | undefined;
        return { image: icon ? withBase(`icons/${icon}.svg`) : null };
      },
      { filters: ["icon"] },
    );
  });
};
