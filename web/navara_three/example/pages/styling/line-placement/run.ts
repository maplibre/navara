import ThreeView, {
  Color,
  type Facing,
  fetchFontFamilyFromCss,
  type Layer,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";
import { Pane } from "tweakpane";

import {
  addCameraControl,
  addHidePaneKeyShortcut,
} from "../../../helpers/control";
import {
  googleFontsCssUrl,
  NOTO_SANS_ATTRIBUTION,
  notoSansStack,
} from "../../../helpers/fonts";

import { CENTER, makeCurves } from "./data";

/**
 * Text and sprites placed along a handful of made-up curves, for exercising
 * line placement without a real street network in the way.
 *
 * `spacing` is in screen pixels: anchors thin out as the camera pulls back and
 * fill in as it closes, without ever moving.
 */

/** An arrow pointing up, i.e. along the line once laid flat and turned to it. */
const ARROW =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
       <polygon points="32,4 58,58 32,44 6,58" fill="#ffd166" stroke="#111318" stroke-width="5"/>
     </svg>`,
  );

type Placement = "point" | "line" | "line-center";

/**
 * Family name the label faces are registered under. One Navara font family
 * maps codepoints to faces by unicode range, so Latin, Arabic and Japanese
 * names all resolve through this single `font`.
 */
const LABEL_FONT = "LineLabels";

type Script = "en" | "ar" | "ja" | "mixed";
const SCRIPTS: Script[] = ["en", "ar", "ja"];

const PLACEMENT_OPTIONS = {
  "along the line": "line",
  "line midpoint": "line-center",
  "per vertex": "point",
};

const dataParams = {
  curviness: 1,
  vertexSpacing: 20,
  reverse: false,
  showVertices: false,
};

const labelParams = {
  show: true,
  /** Which name to label with; `mixed` cycles the scripts shape by shape. */
  script: "mixed" as Script,
  /** Replaces every shape's name when non-empty. */
  text: "",
  placement: "line" as Placement,
  // A label longer than three quarters of it spreads its repeats further.
  spacing: 250,
  maxAngle: 45,
  keepUpright: true,
  lineOffset: 0,
  textFacing: "flat" as Facing,
  size: 18,
  sizeInMeters: false,
  outlineWidth: 4,
  declutter: false,
  height: 0,
};

const spriteParams = {
  show: true,
  placement: "line" as Placement,
  spacing: 60,
  rotateToLine: true,
  // Laid flat and frozen in the anchor's east-north-up frame, `rotation` is a
  // compass bearing — which is what the line's tangent is added to.
  facing: "flat" as Facing,
  rotateWithCamera: false,
  rotation: 0,
  size: 20,
  sizeInMeters: false,
  declutter: false,
  height: 0,
};

export const run = async (view: ThreeView) => {
  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const tileset = new TileJsonPlugin();
  view.addPlugin(tileset);

  await view.init();

  // The Google Fonts CSS API orders @font-face blocks alphabetically, so the
  // stack is passed as a fontFamily array to restore its priority. Faces are
  // fetched lazily per unicode range: only the scripts on screen cost a request.
  const fontStack = notoSansStack(700);
  view.addFontFamily(
    await fetchFontFamilyFromCss(LABEL_FONT, googleFontsCssUrl(fontStack), {
      fontFamily: fontStack.map((family) => family.split(":")[0]),
    }),
  );

  view.setCamera({
    lng: CENTER.lng,
    lat: CENTER.lat - 0.035,
    height: 5200,
    heading: 0,
    pitch: -55,
    roll: 0,
  });

  // A dark basemap for the draped lines to composite onto; the TileJSON
  // document registers its own attribution.
  const basemap = await tileset.addSource({
    type: "raster-tile",
    url: "https://papers.reearth.land/styles/papers-dark/tilejson.json",
  });
  view.addLayer({ type: "raster", source: basemap });

  const source = view.addSource({
    type: "geojson",
    data: makeCurves(dataParams),
  });

  view.addLayer({
    type: "vector",
    source,
    polyline: {
      color: new Color().setStyle("#5c7cfa"),
      width: 4,
      clampToGround: true,
    },
  });

  // The raw vertices, to compare "per vertex" against the resampled anchors.
  const addVertices = () =>
    view.addLayer({
      type: "vector",
      source,
      point: {
        geometryTypes: ["line"],
        color: new Color().setStyle("#ff6b2c"),
        size: 5,
        sizeInMeters: false,
        clampToGround: true,
      },
    });

  // `placement` and `spacing` decide where the anchors are, which is resolved
  // once when the features are built — rebuilding the layer is what moves them.
  const addLabels = () => {
    const labels = view.addLayer({
      type: "vector",
      source,
      text: {
        font: LABEL_FONT,
        geometryTypes: ["line"],
        placement: labelParams.placement,
        spacing: labelParams.spacing,
        maxAngle: labelParams.maxAngle,
        keepUpright: labelParams.keepUpright,
        lineOffset: labelParams.lineOffset,
        textFacing: labelParams.textFacing,
        size: labelParams.size,
        sizeInMeters: labelParams.sizeInMeters,
        clampToGround: true,
        color: new Color().setStyle("#ffffff"),
        outlineColor: new Color().setStyle("#111318"),
        outlineWidth: labelParams.outlineWidth,
        declutter: labelParams.declutter,
        height: labelParams.height,
      },
    });
    labels.on("featureUpdated", ({ evaluator }) => {
      evaluator.evaluate(
        ({ properties }) => {
          const script =
            labelParams.script === "mixed"
              ? SCRIPTS[(properties?.["index"] as number) % SCRIPTS.length]
              : labelParams.script;
          return {
            text:
              labelParams.text || (properties?.[`name_${script}`] as string),
          };
        },
        { filters: ["index", "name_en", "name_ar", "name_ja"] },
      );
    });
    return labels;
  };

  // `rotateToLine` decides whether the geometry carries a per-anchor bearing
  // at all, so like `placement` and `spacing` it takes a rebuild.
  const addSprites = () =>
    view.addLayer({
      type: "vector",
      source,
      billboard: {
        url: ARROW,
        geometryTypes: ["line"],
        placement: spriteParams.placement,
        spacing: spriteParams.spacing,
        rotateToLine: spriteParams.rotateToLine,
        billboardFacing: spriteParams.facing,
        rotateWithCamera: spriteParams.rotateWithCamera,
        rotation: spriteParams.rotation,
        size: spriteParams.size,
        sizeInMeters: spriteParams.sizeInMeters,
        clampToGround: true,
        transparent: true,
        declutter: spriteParams.declutter,
        height: spriteParams.height,
      },
    });

  let vertices: Layer | undefined;
  let labels: Layer | undefined = addLabels();
  let sprites: Layer | undefined = addSprites();

  const pane = new Pane({ title: "Line Placement" });
  addCameraControl(view, pane);
  addHidePaneKeyShortcut(pane);

  // --- Data ---

  const data = pane.addFolder({ title: "Data" });
  // Swapping the data re-adds every layer on the source against it.
  const regenerate = () => {
    source.update({ type: "geojson", data: makeCurves(dataParams) });
    view.forceUpdate();
  };
  data
    .addBinding(dataParams, "curviness", { min: 0.2, max: 3, step: 0.1 })
    .on("change", regenerate);
  data
    .addBinding(dataParams, "vertexSpacing", {
      label: "vertex spacing (m)",
      min: 2,
      max: 200,
      step: 1,
    })
    .on("change", regenerate);
  data.addBinding(dataParams, "reverse").on("change", regenerate);
  data.addBinding(dataParams, "showVertices").on("change", () => {
    if (vertices) view.deleteLayerById(vertices.id);
    vertices = dataParams.showVertices ? addVertices() : undefined;
    view.forceUpdate();
  });

  // --- Labels ---

  const rebuildLabels = () => {
    if (labels) view.deleteLayerById(labels.id);
    labels = labelParams.show ? addLabels() : undefined;
    view.forceUpdate();
  };
  // `maxAngle` and `keepUpright` are re-decided every placement pass, so they
  // restyle rather than rebuild.
  const restyleLabels = () => {
    labels?.update({
      text: {
        maxAngle: labelParams.maxAngle,
        keepUpright: labelParams.keepUpright,
        lineOffset: labelParams.lineOffset,
        textFacing: labelParams.textFacing,
        size: labelParams.size,
        sizeInMeters: labelParams.sizeInMeters,
        outlineWidth: labelParams.outlineWidth,
        declutter: labelParams.declutter,
        height: labelParams.height,
      },
    });
    view.forceUpdate();
  };

  const labelsFolder = pane.addFolder({ title: "Labels" });
  labelsFolder.addBinding(labelParams, "show").on("change", rebuildLabels);
  // `update` re-runs the evaluator, which is what picks up the new text.
  labelsFolder
    .addBinding(labelParams, "script", {
      options: {
        mixed: "mixed",
        English: "en",
        Arabic: "ar",
        Japanese: "ja",
      },
    })
    .on("change", restyleLabels);
  labelsFolder.addBinding(labelParams, "text").on("change", restyleLabels);
  labelsFolder
    .addBinding(labelParams, "placement", { options: PLACEMENT_OPTIONS })
    .on("change", rebuildLabels);
  labelsFolder
    .addBinding(labelParams, "spacing", {
      label: "spacing (px)",
      min: 20,
      max: 1000,
      step: 10,
    })
    .on("change", rebuildLabels);
  labelsFolder
    .addBinding(labelParams, "maxAngle", { min: 5, max: 180, step: 5 })
    .on("change", restyleLabels);
  labelsFolder
    .addBinding(labelParams, "keepUpright")
    .on("change", restyleLabels);
  labelsFolder
    .addBinding(labelParams, "lineOffset", { min: -30, max: 30, step: 1 })
    .on("change", restyleLabels);
  labelsFolder
    .addBinding(labelParams, "textFacing", {
      options: { upright: "upright", flat: "flat" },
    })
    .on("change", restyleLabels);
  labelsFolder
    .addBinding(labelParams, "size", { min: 6, max: 64, step: 1 })
    .on("change", restyleLabels);
  labelsFolder
    .addBinding(labelParams, "sizeInMeters")
    .on("change", restyleLabels);
  labelsFolder
    .addBinding(labelParams, "outlineWidth", { min: 0, max: 6, step: 0.5 })
    .on("change", restyleLabels);
  labelsFolder.addBinding(labelParams, "declutter").on("change", restyleLabels);
  labelsFolder
    .addBinding(labelParams, "height", { min: 0, max: 100, step: 1 })
    .on("change", restyleLabels);

  // --- Sprites ---

  const rebuildSprites = () => {
    if (sprites) view.deleteLayerById(sprites.id);
    sprites = spriteParams.show ? addSprites() : undefined;
    view.forceUpdate();
  };
  const restyleSprites = () => {
    sprites?.update({
      billboard: {
        billboardFacing: spriteParams.facing,
        rotateWithCamera: spriteParams.rotateWithCamera,
        rotation: spriteParams.rotation,
        size: spriteParams.size,
        sizeInMeters: spriteParams.sizeInMeters,
        declutter: spriteParams.declutter,
        height: spriteParams.height,
      },
    });
    view.forceUpdate();
  };

  const spritesFolder = pane.addFolder({ title: "Sprites" });
  spritesFolder.addBinding(spriteParams, "show").on("change", rebuildSprites);
  spritesFolder
    .addBinding(spriteParams, "placement", { options: PLACEMENT_OPTIONS })
    .on("change", rebuildSprites);
  spritesFolder
    .addBinding(spriteParams, "spacing", {
      label: "spacing (px)",
      min: 10,
      max: 500,
      step: 5,
    })
    .on("change", rebuildSprites);
  spritesFolder
    .addBinding(spriteParams, "rotateToLine")
    .on("change", rebuildSprites);
  spritesFolder
    .addBinding(spriteParams, "facing", {
      options: { upright: "upright", flat: "flat" },
    })
    .on("change", restyleSprites);
  spritesFolder
    .addBinding(spriteParams, "rotateWithCamera")
    .on("change", restyleSprites);
  spritesFolder
    .addBinding(spriteParams, "rotation", { min: -180, max: 180, step: 1 })
    .on("change", restyleSprites);
  spritesFolder
    .addBinding(spriteParams, "size", { min: 6, max: 64, step: 1 })
    .on("change", restyleSprites);
  spritesFolder
    .addBinding(spriteParams, "sizeInMeters")
    .on("change", restyleSprites);
  spritesFolder
    .addBinding(spriteParams, "declutter")
    .on("change", restyleSprites);
  spritesFolder
    .addBinding(spriteParams, "height", { min: 0, max: 100, step: 1 })
    .on("change", restyleSprites);

  view.attribution?.add([NOTO_SANS_ATTRIBUTION]);
};
