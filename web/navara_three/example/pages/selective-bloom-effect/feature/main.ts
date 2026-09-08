import ThreeView, { Color } from "@navaramap/three";
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
