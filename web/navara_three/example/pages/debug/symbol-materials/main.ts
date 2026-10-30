/**
 * Debug page for every text and billboard material option.
 *
 * One vector layer draws both appearances over a dense grid of points, a road
 * and a park (`data.ts`), so placement, decluttering, and the pairing of each
 * label with its billboard all have something to act on. The `text` and
 * `billboard` tabs hold one folder per concern, and each folder's state uses
 * the material's own field names.
 *
 * Most edits apply live through `layer.update()`. A few rebuild the layer
 * (delete + addLayer): options resolved when the features are built
 * (`placement`, `spacing`, `geometryTypes`), `highQuality` (fixed per text
 * batch), the label source, and the choices that unset a field (`auto` facing
 * and rotation, no background), which an update cannot express.
 */
import ThreeView, {
  type Anchor,
  Color,
  type Facing,
  fetchFontFamilyFromCss,
  type Layer,
  type Overlap,
  type SourceGeometryType,
  type TextAlign,
  type TranslateAnchor,
  type VariableAnchor,
  type VectorLayer,
} from "@navaramap/three";
import type {
  SelectiveBloomEffectDesc,
  SelectiveOutlineEffectDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { type FolderApi, type InputBindingApi, Pane } from "tweakpane";

import { data } from "./data";

type TextDescription = NonNullable<VectorLayer["text"]>;
type BillboardDescription = NonNullable<VectorLayer["billboard"]>;
type Placement = "point" | "line" | "line-center";

const view = new ThreeView<DefaultDescriptions>({});
view.addPlugin(new DefaultPlugin());
await view.init();

const FONTS = { sans: "SymbolMaterialsSans", serif: "SymbolMaterialsSerif" };
view.addFontFamily(
  await fetchFontFamilyFromCss(
    FONTS.sans,
    "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700",
  ),
);
view.addFontFamily(
  await fetchFontFamilyFromCss(
    FONTS.serif,
    "https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@700",
  ),
);

view.addLayer({ type: "terrain", ellipsoid: {} });
view.globe.color = new Color().setStyle("#12233a");

// `effectIds` reference these by id; `emissive*` feeds the bloom.
const bloom = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: { strength: 1.5, radius: 0.5, threshold: 0 },
});
const outline = view.addEffect<SelectiveOutlineEffectDesc>({
  selectiveOutline: { color: new Color().setStyle("#ff6b2c"), thickness: 2 },
});
const EFFECTS: Record<string, string[]> = {
  none: [],
  bloom: [bloom.id],
  outline: [outline.id],
  both: [bloom.id, outline.id],
};

// White sprites, so `color` tints them; the soft dot is half transparent to
// show `alphaTest`.
const svg = (body: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">${body}</svg>`,
  );
const SPRITES: Record<string, string> = {
  pin: svg(
    '<path d="M32 4C20 4 12 13 12 25c0 15 20 35 20 35s20-20 20-35C52 13 44 4 32 4z" fill="#fff" stroke="#111318" stroke-width="4"/>',
  ),
  square: svg(
    '<rect x="8" y="8" width="48" height="48" rx="8" fill="#fff" stroke="#111318" stroke-width="4"/>',
  ),
  arrow: svg(
    '<polygon points="32,4 58,58 32,44 6,58" fill="#fff" stroke="#111318" stroke-width="5"/>',
  ),
  "soft dot": svg(
    '<circle cx="32" cy="32" r="28" fill="#fff" fill-opacity="0.5"/>',
  ),
};

// ── State ───────────────────────────────────────────────────────────────────

/** Leaves the field unset, so the engine resolves it (MapLibre's `auto`). */
const AUTO = "auto";
type Auto<T> = T | typeof AUTO;

// Folders both materials share, one factory per folder.
const styleState = (size: number) => ({
  show: true,
  size,
  sizeInMeters: false,
  color: "#ffffff",
  opacity: 1,
  transparent: true,
});
const orientationState = () => ({
  rotateWithCamera: AUTO as Auto<boolean>,
  rotation: 0,
  backfaceCulling: false,
});
const placementState = (spacing: number) => ({
  placement: "point" as Placement,
  spacing,
  fromPoint: true,
  fromLine: true,
  fromPolygon: true,
});
const declutterState = () => ({
  declutter: true,
  declutterRank: 0,
  declutterPriority: 0,
  overlap: "never" as Overlap,
  ignorePlacement: false,
  // Each label touches its own pin, so standalone ones would hide each other.
  standalone: false,
  padding: { top: 2, right: 2, bottom: 2, left: 2 },
});
const surfaceState = () => ({
  clampToGround: true,
  height: 1,
  depthTest: true,
  offsetDepth: true,
});
const effectsState = () => ({
  effect: "none",
  emissiveColor: "#ffd166",
  emissiveIntensity: 0,
});

/** Variable-anchor presets: MapLibre's radial offset of 0.6 em around the
 *  point, without its baseline correction. */
const VARIABLE_ANCHORS: Record<string, VariableAnchor[]> = {
  none: [],
  sides: [
    { anchor: "left", offset: { x: 0.6, y: 0 } },
    { anchor: "right", offset: { x: -0.6, y: 0 } },
    { anchor: "top", offset: { x: 0, y: 0.6 } },
    { anchor: "bottom", offset: { x: 0, y: -0.6 } },
  ],
  corners: (
    ["top-left", "top-right", "bottom-left", "bottom-right"] as const
  ).map((anchor) => ({
    anchor,
    offset: {
      x: anchor.endsWith("left") ? 0.45 : -0.45,
      y: anchor.startsWith("top") ? 0.45 : -0.45,
    },
  })),
};

const text = {
  content: {
    fromFeature: true,
    text: "Label",
    font: FONTS.sans,
    lang: "",
    highQuality: false,
  },
  style: {
    ...styleState(18),
    outlineColor: "#111318",
    outlineWidth: 3,
    outlineOpacity: 1,
    background: false,
    backgroundColor: "#1d3557",
    borderColor: "#ffffff",
    borderWidth: 0.05,
  },
  layout: {
    maxWidth: 0,
    lineHeight: 1,
    textAlign: "center" as TextAlign,
    letterSpacing: 0,
    anchor: "center" as Anchor,
    offset: { x: 0, y: 0 },
    translate: { x: 0, y: 0 },
    translateAnchor: "map" as TranslateAnchor,
    variableAnchors: "none" as keyof typeof VARIABLE_ANCHORS,
  },
  orientation: {
    ...orientationState(),
    textFacing: AUTO as Auto<Facing>,
    keepUpright: true,
  },
  placement: {
    ...placementState(250),
    maxAngle: 45,
    spreadGlyphs: false,
    lineOffset: 0,
  },
  declutter: declutterState(),
  surface: surfaceState(),
  effects: effectsState(),
};

const billboard = {
  image: {
    url: "pin",
    alphaTest: 0.1,
    anchor: "bottom" as Anchor,
    offset: { x: 0, y: 0 },
    translate: { x: 0, y: 0 },
    translateAnchor: "map" as TranslateAnchor,
  },
  style: styleState(28),
  orientation: {
    ...orientationState(),
    billboardFacing: AUTO as Auto<Facing>,
    rotateToLine: true,
  },
  placement: placementState(120),
  declutter: declutterState(),
  surface: surfaceState(),
  effects: effectsState(),
};

// ── State → materials ───────────────────────────────────────────────────────

const color = (hex: string) => new Color().setStyle(hex);

const unlessAuto = <K extends string, T>(key: K, value: Auto<T>) =>
  (value === AUTO ? {} : { [key]: value }) as Partial<Record<K, T>>;

/** The fields text and billboard materials share. */
const sharedFields = (m: typeof text | typeof billboard) => ({
  show: m.style.show,
  size: m.style.size,
  sizeInMeters: m.style.sizeInMeters,
  color: color(m.style.color),
  opacity: m.style.opacity,
  transparent: m.style.transparent,
  ...unlessAuto("rotateWithCamera", m.orientation.rotateWithCamera),
  rotation: m.orientation.rotation,
  backfaceCulling: m.orientation.backfaceCulling,
  placement: m.placement.placement,
  spacing: m.placement.spacing,
  geometryTypes: [
    ...(m.placement.fromPoint ? ["point"] : []),
    ...(m.placement.fromLine ? ["line"] : []),
    ...(m.placement.fromPolygon ? ["polygon"] : []),
  ] as SourceGeometryType[],
  declutter: m.declutter.declutter,
  declutterRank: m.declutter.declutterRank,
  declutterPriority: m.declutter.declutterPriority,
  declutterPadding: [
    m.declutter.padding.top,
    m.declutter.padding.right,
    m.declutter.padding.bottom,
    m.declutter.padding.left,
  ],
  overlap: m.declutter.overlap,
  ignorePlacement: m.declutter.ignorePlacement,
  standalone: m.declutter.standalone,
  ...m.surface,
  effectIds: EFFECTS[m.effects.effect],
  emissiveColor: color(m.effects.emissiveColor),
  emissiveIntensity: m.effects.emissiveIntensity,
});

const textMaterial = (): TextDescription => ({
  ...sharedFields(text),
  text: text.content.text,
  font: text.content.font,
  lang: text.content.lang,
  highQuality: text.content.highQuality,
  outlineColor: color(text.style.outlineColor),
  outlineWidth: text.style.outlineWidth,
  outlineOpacity: text.style.outlineOpacity,
  ...(text.style.background && {
    backgroundColor: color(text.style.backgroundColor),
  }),
  borderColor: color(text.style.borderColor),
  borderWidth: text.style.borderWidth,
  ...text.layout,
  variableAnchors: VARIABLE_ANCHORS[text.layout.variableAnchors],
  ...unlessAuto("textFacing", text.orientation.textFacing),
  keepUpright: text.orientation.keepUpright,
  maxAngle: text.placement.maxAngle,
  spreadGlyphs: text.placement.spreadGlyphs,
  lineOffset: text.placement.lineOffset,
});

const billboardMaterial = (): BillboardDescription => ({
  ...sharedFields(billboard),
  url: SPRITES[billboard.image.url],
  alphaTest: billboard.image.alphaTest,
  anchor: billboard.image.anchor,
  offset: billboard.image.offset,
  translate: billboard.image.translate,
  translateAnchor: billboard.image.translateAnchor,
  ...unlessAuto("billboardFacing", billboard.orientation.billboardFacing),
  rotateToLine: billboard.orientation.rotateToLine,
});

// ── Layers ──────────────────────────────────────────────────────────────────

const source = view.addSource({ type: "geojson", data });

// The road and park outline the along-line placements follow.
view.addLayer({
  type: "vector",
  source,
  polyline: {
    color: color("#4a6fa5"),
    width: 3,
    clampToGround: true,
    geometryTypes: ["line", "polygon"],
  },
  polygon: { color: color("#1b3a2f"), clampToGround: true },
});

let layer: Layer;

const addSymbolLayer = () => {
  layer = view.addLayer({
    type: "vector",
    source,
    text: textMaterial(),
    billboard: billboardMaterial(),
  });
  // An evaluated text wins over the material's, so the material `text` only
  // shows with this off.
  if (text.content.fromFeature) {
    layer.on("featureUpdated", ({ evaluator }) => {
      evaluator.evaluate(
        ({ properties, meshGeomType }) =>
          meshGeomType === "text"
            ? { text: (properties?.["name"] as string) ?? "" }
            : {},
        { filters: ["name"] },
      );
    });
  }
};

addSymbolLayer();

const REBUILD_KEYS = new Set([
  "fromFeature",
  "highQuality",
  "background",
  "textFacing",
  "billboardFacing",
  "rotateWithCamera",
  "placement",
  "spacing",
  "fromPoint",
  "fromLine",
  "fromPolygon",
]);

// ── Pane ────────────────────────────────────────────────────────────────────

const AUTO_BOOLEAN = { auto: AUTO, true: true, false: false };
const AUTO_FACING = { auto: AUTO, upright: "upright", flat: "flat" };
const OPTIONS = {
  placement: { point: "point", line: "line", "line-center": "line-center" },
  overlap: { never: "never", always: "always", cooperative: "cooperative" },
  effect: { none: "none", bloom: "bloom", outline: "outline", both: "both" },
  lang: {
    auto: "",
    ja: "ja",
    "zh-Hans": "zh-Hans",
    "zh-Hant": "zh-Hant",
    ko: "ko",
  },
  textAlign: { left: "left", center: "center", right: "right", auto: "auto" },
  anchor: Object.fromEntries(
    (
      [
        "center",
        "left",
        "right",
        "top",
        "bottom",
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ] as const
    ).map((a) => [a, a]),
  ),
  font: { "Noto Sans JP": FONTS.sans, "Noto Serif JP": FONTS.serif },
  url: Object.fromEntries(Object.keys(SPRITES).map((k) => [k, k])),
};
const OFFSET_EM = {
  x: { min: -3, max: 3, step: 0.1 },
  y: { min: -3, max: 3, step: 0.1 },
};
const TRANSLATE_ANCHOR = { map: "map", viewport: "viewport" };
const OFFSET_PX = {
  x: { min: -60, max: 60, step: 1 },
  y: { min: -60, max: 60, step: 1 },
};

const pane = new Pane({ title: "symbol materials" });
const tabs = pane.addTab({
  pages: [{ title: "text" }, { title: "billboard" }],
});
const [textPage, billboardPage] = tabs.pages;

// Folders both tabs share, added to a tab page.
type Parent = Pick<FolderApi, "addFolder">;
const addStyleFolder = (parent: Parent, s: ReturnType<typeof styleState>) => {
  const f = parent.addFolder({ title: "style" });
  f.addBinding(s, "show");
  f.addBinding(s, "size", { min: 4, max: 96, step: 1 });
  f.addBinding(s, "sizeInMeters");
  f.addBinding(s, "color");
  f.addBinding(s, "opacity", { min: 0, max: 1, step: 0.05 });
  f.addBinding(s, "transparent");
  return f;
};
const addOrientationFolder = (
  parent: Parent,
  s: ReturnType<typeof orientationState>,
) => {
  const f = parent.addFolder({ title: "orientation", expanded: false });
  f.addBinding(s, "rotateWithCamera", { options: AUTO_BOOLEAN });
  f.addBinding(s, "rotation", { min: -180, max: 180, step: 1 });
  f.addBinding(s, "backfaceCulling");
  return f;
};
const addPlacementFolder = (
  parent: Parent,
  s: ReturnType<typeof placementState>,
) => {
  const f = parent.addFolder({ title: "placement", expanded: false });
  f.addBinding(s, "placement", { options: OPTIONS.placement });
  f.addBinding(s, "spacing", {
    label: "spacing (px)",
    min: 10,
    max: 1000,
    step: 10,
  });
  f.addBinding(s, "fromPoint");
  f.addBinding(s, "fromLine");
  f.addBinding(s, "fromPolygon");
  return f;
};
const addDeclutterFolder = (
  parent: Parent,
  s: ReturnType<typeof declutterState>,
) => {
  const f = parent.addFolder({ title: "declutter", expanded: false });
  f.addBinding(s, "declutter");
  f.addBinding(s, "declutterRank", { min: -5, max: 5, step: 1 });
  f.addBinding(s, "declutterPriority", { min: -10, max: 10, step: 1 });
  f.addBinding(s, "overlap", { options: OPTIONS.overlap });
  f.addBinding(s, "ignorePlacement");
  f.addBinding(s, "standalone");
  for (const side of ["top", "right", "bottom", "left"] as const) {
    f.addBinding(s.padding, side, {
      label: `padding ${side}`,
      min: 0,
      max: 60,
      step: 1,
    });
  }
};
const addSurfaceFolder = (
  parent: Parent,
  s: ReturnType<typeof surfaceState>,
) => {
  const f = parent.addFolder({ title: "surface & depth", expanded: false });
  f.addBinding(s, "clampToGround");
  f.addBinding(s, "height", { min: 0, max: 2000, step: 10 });
  f.addBinding(s, "depthTest");
  f.addBinding(s, "offsetDepth");
};
const addEffectsFolder = (
  parent: Parent,
  s: ReturnType<typeof effectsState>,
) => {
  const f = parent.addFolder({ title: "effects", expanded: false });
  f.addBinding(s, "effect", { label: "effectIds", options: OPTIONS.effect });
  f.addBinding(s, "emissiveColor");
  f.addBinding(s, "emissiveIntensity", { min: 0, max: 5, step: 0.1 });
};

// Text tab.
const content = textPage.addFolder({ title: "content" });
content.addBinding(text.content, "fromFeature", { label: "text from feature" });
content.addBinding(text.content, "text");
content.addBinding(text.content, "font", { options: OPTIONS.font });
content.addBinding(text.content, "lang", { options: OPTIONS.lang });
content.addBinding(text.content, "highQuality");

const textStyle = addStyleFolder(textPage, text.style);
textStyle.addBinding(text.style, "outlineColor");
textStyle.addBinding(text.style, "outlineWidth", {
  min: 0,
  max: 10,
  step: 0.5,
});
textStyle.addBinding(text.style, "outlineOpacity", {
  min: 0,
  max: 1,
  step: 0.05,
});
textStyle.addBinding(text.style, "background");
textStyle.addBinding(text.style, "backgroundColor");
textStyle.addBinding(text.style, "borderColor");
textStyle.addBinding(text.style, "borderWidth", {
  min: 0,
  max: 0.5,
  step: 0.01,
});

const layout = textPage.addFolder({ title: "layout", expanded: false });
layout.addBinding(text.layout, "maxWidth", {
  label: "maxWidth (em)",
  min: 0,
  max: 20,
  step: 0.5,
});
layout.addBinding(text.layout, "lineHeight", { min: 0.5, max: 3, step: 0.1 });
layout.addBinding(text.layout, "textAlign", { options: OPTIONS.textAlign });
layout.addBinding(text.layout, "letterSpacing", {
  label: "letterSpacing (em)",
  min: -0.2,
  max: 1,
  step: 0.02,
});
layout.addBinding(text.layout, "anchor", { options: OPTIONS.anchor });
layout.addBinding(text.layout, "offset", {
  label: "offset (em)",
  ...OFFSET_EM,
});
layout.addBinding(text.layout, "translate", {
  label: "translate (px)",
  ...OFFSET_PX,
});
layout.addBinding(text.layout, "translateAnchor", {
  options: TRANSLATE_ANCHOR,
});
layout.addBinding(text.layout, "variableAnchors", {
  options: Object.fromEntries(Object.keys(VARIABLE_ANCHORS).map((k) => [k, k])),
});

const textOrientation = addOrientationFolder(textPage, text.orientation);
textOrientation.addBinding(text.orientation, "textFacing", {
  options: AUTO_FACING,
});
textOrientation.addBinding(text.orientation, "keepUpright");

const textPlacement = addPlacementFolder(textPage, text.placement);
textPlacement.addBinding(text.placement, "maxAngle", {
  min: 5,
  max: 180,
  step: 5,
});
textPlacement.addBinding(text.placement, "spreadGlyphs");
textPlacement.addBinding(text.placement, "lineOffset", {
  min: -40,
  max: 40,
  step: 1,
});

addDeclutterFolder(textPage, text.declutter);
addSurfaceFolder(textPage, text.surface);
addEffectsFolder(textPage, text.effects);

// Billboard tab.
const image = billboardPage.addFolder({ title: "image" });
image.addBinding(billboard.image, "url", { options: OPTIONS.url });
image.addBinding(billboard.image, "alphaTest", { min: 0, max: 1, step: 0.05 });
image.addBinding(billboard.image, "anchor", { options: OPTIONS.anchor });
image.addBinding(billboard.image, "offset", {
  label: "offset (px)",
  ...OFFSET_PX,
});
image.addBinding(billboard.image, "translate", {
  label: "translate (px)",
  ...OFFSET_PX,
});
image.addBinding(billboard.image, "translateAnchor", {
  options: TRANSLATE_ANCHOR,
});

addStyleFolder(billboardPage, billboard.style);

const billboardOrientation = addOrientationFolder(
  billboardPage,
  billboard.orientation,
);
billboardOrientation.addBinding(billboard.orientation, "billboardFacing", {
  options: AUTO_FACING,
});
billboardOrientation.addBinding(billboard.orientation, "rotateToLine");

addPlacementFolder(billboardPage, billboard.placement);
addDeclutterFolder(billboardPage, billboard.declutter);
addSurfaceFolder(billboardPage, billboard.surface);
addEffectsFolder(billboardPage, billboard.effects);

pane.on("change", (ev) => {
  if (REBUILD_KEYS.has((ev.target as InputBindingApi).key)) {
    layer.delete();
    addSymbolLayer();
  } else {
    layer.update({ text: textMaterial(), billboard: billboardMaterial() });
  }
});

const CAMERA = {
  lng: 139.779,
  lat: 35.643,
  height: 6_500,
  heading: 0,
  pitch: -55,
  roll: 0,
};
view.setCamera(CAMERA);
pane
  .addButton({ title: "reset camera" })
  .on("click", () => view.setCamera(CAMERA));
