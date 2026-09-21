import ThreeView, { Color, type Facing } from "@navaramap/three";
import { Pane } from "tweakpane";

import { FONT_DATASETS, TILE_DATASETS } from "../../../helpers/constants";
import {
  addCameraControl,
  addHidePaneKeyShortcut,
} from "../../../helpers/control";

const CENTER = { lng: 139.7671, lat: 35.6812 };

/** An asymmetric arrow, so facing and rotation read unambiguously. */
const ARROW =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
       <polygon points="64,4 120,124 64,96 8,124" fill="#0091ff" stroke="#003a66" stroke-width="8"/>
     </svg>`,
  );

/** One column per geometry kind, four instances down each column. */
const KINDS = ["text", "billboard", "point"] as const;
type Kind = (typeof KINDS)[number];

const COL_SPACING = 0.009;
const ROW_SPACING = 0.006;
const INSTANCES = [0, 1, 2, 3];

const featuresFor = (kind: Kind) => {
  const col = KINDS.indexOf(kind) - 1;
  return INSTANCES.map((i) => ({
    type: "Feature" as const,
    properties: { kind, index: i },
    geometry: {
      type: "Point" as const,
      coordinates: [
        CENTER.lng + col * COL_SPACING,
        CENTER.lat + (1.5 - i) * ROW_SPACING,
      ],
    },
  }));
};

const view = new ThreeView();
await view.init();

view.setCamera({
  lng: CENTER.lng,
  lat: CENTER.lat,
  distance: 4200,
  heading: 0,
  pitch: -45,
  roll: 0,
});

const basemap = view.addSource({
  type: "raster-tile",
  url: TILE_DATASETS.openstreetmap.url,
  maxZoom: 19,
});
view.addLayer({ type: "raster", source: basemap });

/**
 * Material-level values, and which of the three the evaluator varies across
 * the four instances of each layer.
 */
const params = {
  facing: "upright" as Facing,
  rotateWithCamera: true,
  rotation: 0,
  perInstance: "off" as "off" | "rotation" | "facing" | "rotateWithCamera",
};

/**
 * All three values for one instance, with the selected axis varied across the
 * four.
 *
 * Every value is returned every time on purpose: a per-feature value persists
 * until something overwrites it, so an evaluator that simply stopped returning
 * `rotation` would leave the last override in place. Stating the material
 * value explicitly is what hands the instance back.
 */
const valuesFor = (index: number) => ({
  facing:
    params.perInstance === "facing"
      ? ((index % 2 === 0 ? "upright" : "flat") as Facing)
      : params.facing,
  rotateWithCamera:
    params.perInstance === "rotateWithCamera"
      ? index % 2 === 0
      : params.rotateWithCamera,
  rotation: params.perInstance === "rotation" ? index * 45 : params.rotation,
});

const layers = KINDS.map((kind) => {
  const source = view.addSource({
    type: "geojson",
    data: { type: "FeatureCollection", features: featuresFor(kind) },
  });

  const shared = {
    rotateWithCamera: params.rotateWithCamera,
    rotation: params.rotation,
    sizeInMeters: true,
    clampToGround: true,
    declutter: false,
  };

  const layer = view.addLayer({
    type: "vector",
    source,
    ...(kind === "text"
      ? {
          text: {
            ...shared,
            textFacing: params.facing,
            font: FONT_DATASETS.Roboto.url,
            color: new Color().setStyle("#ffffff"),
            outlineColor: new Color().setStyle("#000000"),
            outlineWidth: 3,
            size: 110,
            center: { x: 0.5, y: 0.5 },
          },
        }
      : kind === "billboard"
        ? {
            billboard: {
              ...shared,
              billboardFacing: params.facing,
              url: ARROW,
              size: 400,
              transparent: true,
            },
          }
        : {
            point: {
              ...shared,
              pointFacing: params.facing,
              color: new Color().setStyle("#ff6b2c"),
              size: 300,
            },
          }),
  });

  layer.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        const index = properties?.index as number;
        return {
          // Text needs a label; the other two ignore it.
          text: `${index}`,
          ...valuesFor(index),
        };
      },
      { filters: ["index"] },
    );
  });

  return { kind, layer };
});

/** Push the material-level values to all three layers. */
const applyMaterial = () => {
  for (const { kind, layer } of layers) {
    const common = {
      rotateWithCamera: params.rotateWithCamera,
      rotation: params.rotation,
    };
    if (kind === "text") {
      layer.update({ text: { ...common, textFacing: params.facing } });
    } else if (kind === "billboard") {
      layer.update({
        billboard: { ...common, billboardFacing: params.facing },
      });
    } else {
      layer.update({ point: { ...common, pointFacing: params.facing } });
    }
  }
};

const pane = new Pane({ title: "Facing & rotation" });
addCameraControl(view, pane);
addHidePaneKeyShortcut(pane);

const material = pane.addFolder({ title: "Material (all 3 layers)" });
material
  .addBinding(params, "facing", {
    options: { upright: "upright", flat: "flat" },
  })
  .on("change", applyMaterial);
material.addBinding(params, "rotateWithCamera").on("change", applyMaterial);
material
  .addBinding(params, "rotation", { min: -180, max: 180, step: 1 })
  .on("change", applyMaterial);

const perInstance = pane.addFolder({ title: "Per-instance override" });
perInstance
  .addBinding(params, "perInstance", {
    label: "vary",
    options: {
      off: "off",
      rotation: "rotation",
      facing: "facing",
      rotateWithCamera: "rotateWithCamera",
    },
  })
  // `layer.update` re-runs the evaluator, which is what applies the change.
  .on("change", applyMaterial);

view.attribution?.add([TILE_DATASETS.openstreetmap, FONT_DATASETS.Roboto]);
