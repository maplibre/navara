import ThreeView, {
  Color,
  type Facing,
  fetchFontFamilyFromCss,
  type Layer,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";
import { Pane } from "tweakpane";

import { VECTOR_DATASETS } from "../../../helpers/constants";
import {
  googleFontsCssUrl,
  NOTO_SANS_ATTRIBUTION,
  notoSansStack,
} from "../../../helpers/fonts";

/**
 * Street-name labels repeated along road centerlines, bending with the road,
 * and direction arrows (sprites) spaced along the same roads, turned to their
 * tangent.
 *
 * The data is OpenMapTiles-schema: `transportation` carries road geometry and
 * `transportation_name` carries `name`/`class` on linestrings merged by name.
 * Labelling the merged layer is what keeps one name per road rather than one
 * per segment — though plenty of those merged lines are still only tens of
 * metres long, and a label that would overrun its road is dropped.
 */

/** Road classes worth drawing, widest first. Everything else is filtered out. */
const ROAD_WIDTH: Record<string, number> = {
  motorway: 10,
  trunk: 8,
  primary: 7,
  secondary: 5,
  tertiary: 4,
  minor: 3,
  service: 2,
  residential: 3,
};

/** Bigger roads win an overlap in the declutter pass. */
const LABEL_PRIORITY: Record<string, number> = {
  motorway: 5,
  trunk: 4,
  primary: 3,
  secondary: 2,
  tertiary: 1,
};

/**
 * Family name the label faces are registered under. A Navara font family maps
 * codepoints to faces by unicode range, so one registration covers every script
 * a worldwide road name can be written in.
 *
 * Same stack as the `pmtiles-overture` example's admin labels: Noto Sans at
 * `wdth` 87.5 (the "SemiCondensed" design) in Bold, plus per-script Noto faces.
 * SemiCondensed suits line placement — a narrower name fits on more roads before
 * it would overrun them and get dropped.
 */
const LABEL_FONT = "RoadLabels";
const LABEL_WEIGHT = 700;
const LABEL_WIDTH = 87.5;

/** An arrow pointing up, i.e. north once laid flat and turned to the line. */
const ARROW =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
       <polygon points="32,4 58,58 32,44 6,58" fill="#ffd166" stroke="#111318" stroke-width="5"/>
     </svg>`,
  );

type Placement = "point" | "line" | "line-center";

const params = {
  showLabels: true,
  placement: "line" as Placement,
  spacing: 250,
  maxAngle: 20,
  keepUpright: true,
  lineOffset: 0,
  size: 15,
  sizeInMeters: false,
  outlineWidth: 6,
  declutter: true,
};

const spriteParams = {
  showSprites: true,
  placement: "line" as Placement,
  spacing: 150,
  rotateToLine: true,
  // Laid flat and frozen in the anchor's east-north-up frame, `rotation` is a
  // compass bearing — which is what the line's tangent is added to.
  facing: "flat" as Facing,
  rotateWithCamera: false,
  rotation: 0,
  size: 18,
  sizeInMeters: false,
  oneWayOnly: false,
  declutter: true,
};

export const run = async (view: ThreeView) => {
  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  const tileset = new TileJsonPlugin();
  view.addPlugin(tileset);

  await view.init();

  // The Google Fonts CSS API orders @font-face blocks alphabetically, so pass
  // the stack as a fontFamily array to restore the intended priority (e.g. JP
  // before SC/KR for codepoints shared across CJK subsets). Face files are
  // fetched lazily per unicode range, so a stack this wide costs one CSS request
  // plus only the faces the visible labels actually need.
  const fontStack = notoSansStack(LABEL_WEIGHT, LABEL_WIDTH);
  view.addFontFamily(
    await fetchFontFamilyFromCss(LABEL_FONT, googleFontsCssUrl(fontStack), {
      fontFamily: fontStack.map((family) => family.split(":")[0]),
    }),
  );

  // Central London: dense named streets that actually curve, which is what
  // `maxAngle` and the curved layout are there to handle. Close enough that a
  // street is many times longer on screen than its name:
  // a label is dropped when it would overrun the road it sits on, so pulling
  // back thins the labels out exactly as it does on any other map.
  view.setCamera({
    lng: -0.1276,
    lat: 51.5105,
    height: 1500,
    heading: 0,
    pitch: -55,
    roll: 0,
  });

  // A dark basemap: draped geometry needs a surface to composite onto, and the
  // white labels need something low-contrast to sit on.
  //
  // The URL is a TileJSON *document*, not a `{z}/{x}/{y}` tile template, so it
  // goes through `TileJsonPlugin.addSource` — `view.addSource` would take the
  // string as the template itself and request that one URL as an image for every
  // tile. The plugin fetches the document, derives the tile URL and zoom range
  // from it, and registers the document's `attribution` with the credit UI.
  const basemap = await tileset.addSource({
    type: "raster-tile",
    url: "https://papers.reearth.land/styles/papers-dark/tilejson.json",
    // url: TILE_DATASETS.eox.url,
  });
  view.addLayer({ type: "raster", source: basemap });

  const planet = view.addSource({
    type: "vector-tile",
    url: VECTOR_DATASETS.openFreeMapPlanet.url,
    maxZoom: 14,
  });

  // Road geometry, for the labels to sit on.
  const roads = view.addLayer({
    type: "vector",
    source: planet,
    sourceLayers: ["transportation"],
    polyline: {
      color: new Color().setStyle("#a8e8a6"),
      width: 4,
      clampToGround: true,
      geometryTypes: ["line"],
    },
  });

  roads.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        const width = ROAD_WIDTH[properties?.["class"] as string];
        return width === undefined ? { show: false } : { width };
      },
      { filters: ["class"] },
    );
  });

  addControls(
    view,
    labelsLayerFactory(view, planet),
    spritesLayerFactory(view, planet),
  );

  // The basemap credit is registered by TileJsonPlugin from the document, so
  // only the sources added by hand are listed here.
  view.attribution?.add([
    VECTOR_DATASETS.openFreeMapPlanet,
    NOTO_SANS_ATTRIBUTION,
  ]);
};

/**
 * Build the label layer from the current `params`.
 *
 * `geometryTypes: ["line"]` opts the text appearance into line geometry;
 * `placement` then decides whether that means one label per vertex (the
 * historical behaviour) or labels spaced along the line.
 *
 * Returned as a factory rather than a layer so the panel can rebuild it: the
 * options that decide where the anchors go are read when a tile is parsed, and
 * re-parsing is what a rebuild buys.
 */
const labelsLayerFactory =
  (view: ThreeView, source: ReturnType<ThreeView["addSource"]>) =>
  (): Layer => {
    const labels = view.addLayer({
      type: "vector",
      source,
      sourceLayers: ["transportation_name"],
      text: {
        font: LABEL_FONT,
        geometryTypes: ["line"],
        placement: params.placement,
        spacing: params.spacing,
        maxAngle: params.maxAngle,
        keepUpright: params.keepUpright,
        lineOffset: params.lineOffset,
        // Line placement always lays the label in the ground plane and takes its
        // direction from the line, so `rotateWithCamera` has no effect here.
        textFacing: "flat",
        size: params.size,
        sizeInMeters: params.sizeInMeters,
        clampToGround: true,
        color: new Color().setStyle("#ffffff"),
        outlineColor: new Color().setStyle("#111318"),
        outlineWidth: params.outlineWidth,
        declutter: params.declutter,
      },
    });

    labels.on("featureUpdated", ({ evaluator }) => {
      evaluator.evaluate(
        ({ properties }) => {
          const name = properties?.["name"] as string | undefined;
          if (!name) return { show: false, text: "" };
          return {
            text: name,
            show: true,
            declutterPriority:
              LABEL_PRIORITY[properties?.["class"] as string] ?? 0,
          };
        },
        { filters: ["name", "class"] },
      );
    });

    return labels;
  };

/**
 * Build the sprite layer from the current `spriteParams`.
 *
 * Sprites sit on the road geometry itself (`transportation`), not on the
 * merged name lines, so every road segment gets its own run of arrows.
 * `rotateToLine` adds each anchor's tangent bearing to `rotation`; it decides
 * whether the geometry carries a per-anchor bearing at all, so like
 * `placement` and `spacing` it only takes effect on a rebuild.
 */
const spritesLayerFactory =
  (view: ThreeView, source: ReturnType<ThreeView["addSource"]>) =>
  (): Layer => {
    const sprites = view.addLayer({
      type: "vector",
      source,
      sourceLayers: ["transportation"],
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
      },
    });

    sprites.on("featureUpdated", ({ evaluator }) => {
      evaluator.evaluate(
        ({ properties }) => {
          const drawn =
            ROAD_WIDTH[properties?.["class"] as string] !== undefined;
          // OpenMapTiles marks a one-way road `1` when traffic follows the
          // line's direction and `-1` when it runs against it.
          const oneway = properties?.["oneway"] as number | undefined;
          const show = drawn && (!spriteParams.oneWayOnly || !!oneway);
          return {
            show,
            // Returned every time: a per-feature value persists until
            // overwritten, so this is also what carries a slider change.
            rotation: spriteParams.rotation + (oneway === -1 ? 180 : 0),
          };
        },
        { filters: ["class", "oneway"] },
      );
    });

    return sprites;
  };

const addControls = (
  view: ThreeView,
  addLabels: () => Layer,
  addSprites: () => Layer,
) => {
  const pane = new Pane({ title: "Line Labels & Sprites" });
  let labels: Layer | undefined = params.showLabels ? addLabels() : undefined;
  let sprites: Layer | undefined = spriteParams.showSprites
    ? addSprites()
    : undefined;

  // Style the labels already on screen. Everything bound to this takes effect
  // on the next frame.
  const restyle = () => {
    labels?.update({
      text: {
        maxAngle: params.maxAngle,
        keepUpright: params.keepUpright,
        lineOffset: params.lineOffset,
        size: params.size,
        sizeInMeters: params.sizeInMeters,
        outlineWidth: params.outlineWidth,
        declutter: params.declutter,
      },
    });
    view.forceUpdate();
  };

  // `placement` and `spacing` decide *where the anchors are*, which is resolved
  // once when a tile is parsed and then baked into its geometry — a style
  // update cannot move them, and the tiles already on screen keep the anchors
  // they were built with. Rebuilding the layer is what re-parses them.
  //
  // `maxAngle` and `keepUpright` look like they belong in this group but do
  // not: both are re-decided every placement pass, because they depend on the
  // camera. They stay on `restyle`.
  const rebuild = () => {
    if (labels) view.deleteLayerById(labels.id);
    labels = params.showLabels ? addLabels() : undefined;
    view.forceUpdate();
  };

  const labelsFolder = pane.addFolder({ title: "Labels" });
  labelsFolder.addBinding(params, "showLabels").on("change", rebuild);

  const placement = labelsFolder.addFolder({ title: "Placement" });
  placement
    .addBinding(params, "placement", {
      options: {
        "along the line": "line",
        "line midpoint": "line-center",
        "per vertex": "point",
      },
    })
    .on("change", rebuild);
  placement
    .addBinding(params, "spacing", { min: 30, max: 800, step: 10 })
    .on("change", rebuild);
  placement
    .addBinding(params, "maxAngle", { min: 5, max: 180, step: 5 })
    .on("change", restyle);
  placement.addBinding(params, "keepUpright").on("change", restyle);
  placement
    .addBinding(params, "lineOffset", { min: -30, max: 30, step: 1 })
    .on("change", restyle);

  const style = labelsFolder.addFolder({ title: "Style" });
  style
    .addBinding(params, "size", { min: 6, max: 48, step: 1 })
    .on("change", restyle);
  style.addBinding(params, "sizeInMeters").on("change", restyle);
  style
    .addBinding(params, "outlineWidth", { min: 0, max: 6, step: 0.5 })
    .on("change", restyle);
  style.addBinding(params, "declutter").on("change", restyle);

  // Same split as the labels: anchor positions and bearings are baked into the
  // tile geometry, everything else is material state.
  // `rotation` is left to the evaluator, which `update` re-runs: it is per
  // feature here (one-way roads drawn against their line flip by 180°).
  const restyleSprites = () => {
    sprites?.update({
      billboard: {
        billboardFacing: spriteParams.facing,
        rotateWithCamera: spriteParams.rotateWithCamera,
        size: spriteParams.size,
        sizeInMeters: spriteParams.sizeInMeters,
        declutter: spriteParams.declutter,
      },
    });
    view.forceUpdate();
  };

  const rebuildSprites = () => {
    if (sprites) view.deleteLayerById(sprites.id);
    sprites = spriteParams.showSprites ? addSprites() : undefined;
    view.forceUpdate();
  };

  const spritesFolder = pane.addFolder({ title: "Sprites" });
  spritesFolder
    .addBinding(spriteParams, "showSprites")
    .on("change", rebuildSprites);
  spritesFolder
    .addBinding(spriteParams, "placement", {
      options: {
        "along the line": "line",
        "line midpoint": "line-center",
        "per vertex": "point",
      },
    })
    .on("change", rebuildSprites);
  spritesFolder
    .addBinding(spriteParams, "spacing", { min: 30, max: 800, step: 10 })
    .on("change", rebuildSprites);
  spritesFolder
    .addBinding(spriteParams, "rotateToLine")
    .on("change", rebuildSprites);
  spritesFolder
    .addBinding(spriteParams, "oneWayOnly")
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
};
