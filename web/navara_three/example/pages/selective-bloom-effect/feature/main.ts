import ThreeView, { Color, fetchFontFamilyFromCss } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

import {
  TERRAIN_DATASETS,
  TILES_3D_DATASETS,
} from "../../../helpers/constants";

const run = async () => {
  const view = new ThreeView<DefaultDescriptions>({
    debug: true,
  });

  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const attribution = view.attribution;

  await view.init();

  view.setCamera({
    lng: 139.7586,
    lat: 35.6735,
    height: 200,
    heading: 71,
    pitch: -20,
    distance: 800,
    roll: 0,
  });

  // Selective bloom effect
  const bloomEffect = view.addEffect({
    selectiveBloom: {
      strength: 0.5,
      radius: 0.5,
    },
  });

  view.addLight({ ambient: { intensity: 1 } });
  view.addEffect({ ssao: {} });

  const addPlateauLayer = (url: string) => {
    const source = view.addSource({
      type: "3d-tiles",
      url,
    });
    const layer = view.addLayer({
      type: "3d-tiles",
      source,
      model: {
        show: true,
        color: new Color().setHex(0xffffff),
        metalness: 0,
        roughness: 1,
        effectIds: [bloomEffect.id],
      },
    });
    layer.on("featureUpdated", ({ evaluator }) => {
      evaluator.evaluate(
        ({ properties }) => {
          const measuredHeight =
            (properties?.["bldg:measuredHeight"] as number) ?? 0;
          const t = Math.max(0, Math.min(1, measuredHeight / 150));

          return {
            emissive: new Color().setRGB(
              0.5 + 0.35 * t,
              0.5 + 0.3 * t,
              0.5 + 0.15 * t,
            ),
            emissiveIntensity: 1.1 * t,
          };
        },
        { filters: ["bldg:measuredHeight"] },
      );
    });
  };

  addPlateauLayer(TILES_3D_DATASETS.plateauChiyoda.url);
  addPlateauLayer(TILES_3D_DATASETS.plateauChuo.url);

  // Text labels with per-feature emissive: only the glyph fill blooms —
  // outline and background stay dark.
  view.addFontFamily(
    await fetchFontFamilyFromCss(
      "Arsenal",
      "https://fonts.googleapis.com/css2?family=Arsenal:wght@700",
    ),
  );
  const labelSource = view.addSource({
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [139.7671, 35.6812] },
          properties: { name: "TOKYO", glow: 1.5 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [139.7745, 35.6847] },
          properties: { name: "NIHONBASHI", glow: 0.6 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [139.76, 35.675] },
          properties: { name: "MARUNOUCHI", glow: 0 },
        },
      ],
    },
  });
  const textLayer = view.addLayer({
    type: "vector",
    source: labelSource,
    text: {
      font: "Arsenal",
      color: new Color().setStyle("#ffffff"),
      size: 26,
      sizeInMeters: false,
      clampToGround: true,
      height: 250,
      outlineColor: new Color().setStyle("#000000"),
      outlineWidth: 4,
      effectIds: [bloomEffect.id],
    },
  });
  textLayer.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        const glow = (properties?.["glow"] as number) ?? 0;
        return {
          text: (properties?.["name"] as string) ?? "",
          emissive: new Color().setStyle("#7fd0ff"),
          emissiveIntensity: glow,
        };
      },
      { filters: ["name", "glow"] },
    );
  });

  const gsiTerrainDem = view.addSource({
    type: "quantized-mesh",
    url: TERRAIN_DATASETS.reearthQuantizedMesh.url,
    requestVertexNormals: true,
    maxZoom: 18,
  });
  view.addLayer({
    type: "terrain",
    source: gsiTerrainDem,
  });

  view.globe.color = new Color().setStyle("#555");

  attribution?.add([
    TERRAIN_DATASETS.reearthQuantizedMesh,
    TILES_3D_DATASETS.plateauChiyoda,
    TILES_3D_DATASETS.plateauChuo,
  ]);
};

run();
