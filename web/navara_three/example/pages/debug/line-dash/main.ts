/**
 * Debug page for the polyline `dashArray` / `cap` options.
 *
 * One row per dash setting and one column per way a polyline is drawn, so
 * every combination is visible at once:
 * - a layer with `clampToGround`, which bakes its lines into the terrain tiles
 * - a layer without it, drawn in the 3D scene
 * - a `PolylineMeshDesc` with `clampToGround`
 * - a `PolylineMeshDesc` without it
 *
 * The two layers set the pattern per feature from a `FeatureEvaluator`, the
 * meshes through their own style, which covers both ways of setting it.
 *
 * Each line bends twice and turns one sharp corner, to show how a pattern
 * crosses a joint. The "ends" rows hold short straight lines instead, to show
 * how a pattern meets a line's end. The last row takes its pattern from the
 * pane.
 *
 * One line per column also runs once around the equator, side by side in
 * the columns' order from north to south: their length runs from zero to the
 * equator's full length at the seam on the antimeridian, and the camera
 * presets look along them across many pattern sizes.
 */
import ThreeView, {
  Color,
  fetchFontFamilyFromCss,
  type LatLngHeight,
  type LineCap,
  type MeshHandle,
} from "@navaramap/three";
import type { PolylineMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

type DashSetting = { dashArray: number[]; cap: LineCap };

const params = {
  width: 6,
  customDashArray: "6, 2, 1, 2",
  customCap: "butt" as LineCap,
  /** Row whose setting the equator lines take. */
  equatorRow: 8,
};

// Dash and gap lengths in line widths.
const SETTINGS: DashSetting[] = [
  { dashArray: [], cap: "butt" },
  { dashArray: [2, 2], cap: "butt" },
  { dashArray: [4, 2], cap: "butt" },
  // An odd-length array: its last dash joins its first one.
  { dashArray: [1, 2, 1], cap: "butt" },
  { dashArray: [4, 2, 1, 2], cap: "butt" },
  { dashArray: [2, 2], cap: "square" },
  { dashArray: [2, 2], cap: "round" },
  // A zero-length dash draws nothing unless the cap is round.
  { dashArray: [0, 2], cap: "butt" },
  { dashArray: [0, 2], cap: "round" },
  { dashArray: [0, 1.5], cap: "round" },
  { dashArray: [0, 4], cap: "round" },
  { dashArray: [3, 2, 0, 2], cap: "round" },
];
// Rows of short straight lines, each 20 m longer than the one before. A
// volume line lays its pattern out from its start, so their ends fall at
// different phases of it: some just past a dot, which must be left out
// whole, never cut to a sliver.
const END_SETTING: DashSetting = { dashArray: [0, 1], cap: "round" };
/** Lengths of the lines in each "ends" row, in meters. */
const END_ROW_LENGTHS = [
  [60, 80, 100, 120],
  [140, 160, 180, 200],
];
/** Gap between the lines of an "ends" row, in meters: wider than a line. */
const END_LINE_GAP = 130;
const END_ROW = SETTINGS.length;
const CUSTOM_ROW = END_ROW + END_ROW_LENGTHS.length;

const describe = ({ dashArray, cap }: DashSetting): string =>
  dashArray.length === 0 ? "solid" : `[${dashArray.join(", ")}] ${cap}`;

const parseDashArray = (text: string): number[] =>
  text
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));

const settingOf = (row: number): DashSetting => {
  if (row === CUSTOM_ROW) {
    return {
      dashArray: parseDashArray(params.customDashArray),
      cap: params.customCap,
    };
  }
  return row >= END_ROW ? END_SETTING : SETTINGS[row];
};

const labelOf = (row: number): string => {
  if (row === CUSTOM_ROW) return "custom (pane)";
  if (row >= END_ROW) {
    return `${describe(END_SETTING)}, ends ${row - END_ROW + 1}/${END_ROW_LENGTHS.length}`;
  }
  return describe(SETTINGS[row]);
};

// ── Layout (degrees) ────────────────────────────────────────────────────────

const ORIGIN = { lng: 140.1, lat: 35.7 };
const COLUMN_WIDTH = 0.012;
const COLUMN_GAP = 0.004;
const ROW_STEP = 0.0018;
const ROW_COUNT = CUSTOM_ROW + 1;
const COLUMNS = [
  "layer / clampToGround",
  "layer / 3D",
  "mesh / clampToGround",
  "mesh / 3D",
];
/** Height of the lines that are not clamped, in meters. */
const UNCLAMPED_HEIGHT = 5;

const columnLng = (column: number): number =>
  ORIGIN.lng + column * (COLUMN_WIDTH + COLUMN_GAP);
const rowLat = (row: number): number => ORIGIN.lat - row * ROW_STEP;
/** Degrees of longitude per meter at the page's latitude. */
const LNG_PER_METER = 1 / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180));

/** The line of one cell: two shallow bends, then a sharp corner. */
const cellPositions = (column: number, row: number): LatLngHeight[] => {
  const lng = columnLng(column);
  const lat = rowLat(row);
  const at = (x: number, y: number): LatLngHeight => ({
    lng: lng + x * COLUMN_WIDTH,
    lat: lat + y * ROW_STEP,
    height: 0,
  });
  return [
    at(0, 0),
    at(0.3, 0),
    at(0.45, 0.3),
    at(0.6, 0),
    at(0.8, 0),
    at(0.88, 0.35),
    at(0.96, 0),
    at(1, 0),
  ];
};

/** The lines of one cell: one bent line, or an "ends" row's straight ones. */
const cellLines = (column: number, row: number): LatLngHeight[][] => {
  if (row < END_ROW || row === CUSTOM_ROW) return [cellPositions(column, row)];
  const lat = rowLat(row);
  let lng = columnLng(column);
  return END_ROW_LENGTHS[row - END_ROW].map((length) => {
    const line = [
      { lng, lat, height: 0 },
      { lng: lng + length * LNG_PER_METER, lat, height: 0 },
    ];
    lng += (length + END_LINE_GAP) * LNG_PER_METER;
    return line;
  });
};

const lineFeatures = (column: number) => {
  const features = [];
  for (let row = 0; row < ROW_COUNT; row++) {
    for (const line of cellLines(column, row)) {
      features.push({
        type: "Feature" as const,
        properties: { row },
        geometry: {
          type: "LineString" as const,
          coordinates: line.map((p) => [p.lng, p.lat]),
        },
      });
    }
  }
  return { type: "FeatureCollection" as const, features };
};

const labelFeatures = () => {
  const features = [];
  for (let row = 0; row < ROW_COUNT; row++) {
    features.push({
      type: "Feature" as const,
      properties: { label: labelOf(row) },
      geometry: {
        type: "Point" as const,
        coordinates: [ORIGIN.lng - 0.009, rowLat(row)],
      },
    });
  }
  for (let column = 0; column < COLUMNS.length; column++) {
    features.push({
      type: "Feature" as const,
      properties: { label: COLUMNS[column] },
      geometry: {
        type: "Point" as const,
        coordinates: [columnLng(column) + COLUMN_WIDTH / 2, rowLat(-1)],
      },
    });
    // On both sides of the equator lines' seam, north of each line so that
    // the label does not cover it.
    for (const lng of [-179.97, 179.97]) {
      features.push({
        type: "Feature" as const,
        properties: { label: COLUMNS[column], column },
        geometry: {
          type: "Point" as const,
          coordinates: [lng, equatorLat(column) + EQUATOR_LABEL_OFFSET],
        },
      });
    }
  }
  return { type: "FeatureCollection" as const, features };
};

// ── View ────────────────────────────────────────────────────────────────────

const LABEL_FONT = "LineDashLabels";
const LINE_COLOR = new Color().setStyle("#ffd23f");

const view = new ThreeView<DefaultDescriptions>({ debug: true });
view.addPlugin(new DefaultPlugin());
await view.init();

view.addFontFamily(
  await fetchFontFamilyFromCss(
    LABEL_FONT,
    "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@600",
  ),
);

view.addLayer({ type: "terrain", ellipsoid: {} });
view.globe.color = new Color().setStyle("#12233a");

// ── Layers: the pattern per feature ─────────────────────────────────────────

const addLineLayer = (column: number, clampToGround: boolean) => {
  const source = view.addSource({
    type: "geojson",
    data: lineFeatures(column),
  });
  const layer = view.addLayer({
    type: "vector",
    source,
    polyline: {
      color: LINE_COLOR,
      width: params.width,
      maxWidth: 1_000_000,
      clampToGround,
      height: clampToGround ? 0 : UNCLAMPED_HEIGHT,
      // The plain color, like the baked lines and the meshes.
      lit: false,
    },
  });
  layer.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => settingOf(Number(properties?.["row"])),
      { filters: ["row"] },
    );
  });
  return layer;
};

const layers = [addLineLayer(0, true), addLineLayer(1, false)];

// ── Meshes: the pattern in the style ────────────────────────────────────────

/** The meshes of one column, by row. */
const addLineMeshes = (column: number, clampToGround: boolean) => {
  const meshes: MeshHandle<PolylineMeshDesc>[][] = [];
  for (let row = 0; row < ROW_COUNT; row++) {
    meshes.push(
      cellLines(column, row).map((positions) =>
        view.addMesh<PolylineMeshDesc>({
          polyline: {
            positions,
            color: LINE_COLOR,
            width: params.width,
            maxWidth: 1_000_000,
            clampToGround,
            height: clampToGround ? 0 : UNCLAMPED_HEIGHT,
            ...settingOf(row),
          },
          lit: false,
        }),
      ),
    );
  }
  return meshes;
};

const meshColumns = [addLineMeshes(2, true), addLineMeshes(3, false)];

// ── Equator: one line around the globe per column ──────────────────────────

/** Latitude of each column's equator line, north to south, in degrees. */
const equatorLat = (column: number): number => 0.006 - column * 0.004;
/** Latitude offset of an equator line's label: halfway to the next line. */
const EQUATOR_LABEL_OFFSET = 0.002;
/**
 * Positions around the equator at `lat`, one per degree, starting and ending
 * on the antimeridian.
 */
const equatorPositions = (lat: number): LatLngHeight[] => {
  const positions: LatLngHeight[] = [];
  for (let lng = -180; lng < 180; lng++) {
    positions.push({ lng, lat, height: 0 });
  }
  positions.push({ lng: -180, lat, height: 0 });
  return positions;
};

const addEquatorLayer = (column: number, clampToGround: boolean) => {
  const layer = view.addLayer({
    type: "vector",
    source: view.addSource({
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: equatorPositions(equatorLat(column)).map((p) => [
            p.lng,
            p.lat,
          ]),
        },
      },
    }),
    polyline: {
      color: LINE_COLOR,
      width: params.width,
      maxWidth: 1_000_000,
      clampToGround,
      height: clampToGround ? 0 : UNCLAMPED_HEIGHT,
      lit: false,
    },
  });
  layer.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(() => settingOf(params.equatorRow));
  });
  return layer;
};

const addEquatorMesh = (column: number, clampToGround: boolean) =>
  view.addMesh<PolylineMeshDesc>({
    polyline: {
      positions: equatorPositions(equatorLat(column)),
      ring: true,
      color: LINE_COLOR,
      width: params.width,
      maxWidth: 1_000_000,
      clampToGround,
      height: clampToGround ? 0 : UNCLAMPED_HEIGHT,
      ...settingOf(params.equatorRow),
    },
    lit: false,
  });

const equatorLayers = [addEquatorLayer(0, true), addEquatorLayer(1, false)];
const equatorMeshes = [addEquatorMesh(2, true), addEquatorMesh(3, false)];

const applyEquatorSetting = () => {
  for (const layer of equatorLayers) layer.forceUpdate();
  for (const mesh of equatorMeshes) {
    mesh.update({ polyline: settingOf(params.equatorRow) });
  }
};

// ── Labels ──────────────────────────────────────────────────────────────────

/** Whether each column is shown, by its title; see the pane's "show". */
const shownColumns: Record<string, boolean> = {};
for (const column of COLUMNS) shownColumns[column] = true;

const labelLayer = view.addLayer({
  type: "vector",
  source: view.addSource({ type: "geojson", data: labelFeatures() }),
  text: {
    font: LABEL_FONT,
    size: 13,
    sizeInMeters: false,
    clampToGround: true,
    color: new Color().setStyle("#ffffff"),
    outlineColor: new Color().setStyle("#12233a"),
    outlineWidth: 3,
    declutter: false,
  },
});
labelLayer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => {
      // An equator line's label hides with its column.
      const column = properties?.["column"];
      return {
        text: String(properties?.["label"] ?? ""),
        show: column === undefined || shownColumns[COLUMNS[Number(column)]],
      };
    },
    { filters: ["label", "column"] },
  );
});

// ── Pane ────────────────────────────────────────────────────────────────────

const pane = new Pane({ title: "Line dash" });

pane
  .addBinding(params, "width", { min: 1, max: 30, step: 1 })
  .on("change", ({ value }) => {
    for (const layer of layers) {
      layer.update({ polyline: { width: value } });
    }
    for (const meshes of meshColumns) {
      for (const mesh of meshes.flat()) {
        mesh.update({ polyline: { width: value } });
      }
    }
    for (const layer of equatorLayers) {
      layer.update({ polyline: { width: value } });
    }
    for (const mesh of equatorMeshes) {
      mesh.update({ polyline: { width: value } });
    }
  });

// One switch per column, for its cells, its equator line and its label.
const showColumn = (column: number, show: boolean) => {
  labelLayer.forceUpdate();
  if (column < layers.length) {
    for (const layer of [layers[column], equatorLayers[column]]) {
      layer.update({ polyline: { show } });
    }
    return;
  }
  const meshColumn = column - layers.length;
  for (const mesh of [
    ...meshColumns[meshColumn].flat(),
    equatorMeshes[meshColumn],
  ]) {
    mesh.update({ visible: show });
  }
};
const showFolder = pane.addFolder({ title: "show" });
COLUMNS.forEach((title, column) => {
  showFolder
    .addBinding(shownColumns, title)
    .on("change", ({ value }) => showColumn(column, value));
});

const applyCustomSetting = () => {
  // The layers read the setting from their evaluator.
  for (const layer of layers) {
    layer.forceUpdate();
  }
  for (const meshes of meshColumns) {
    for (const mesh of meshes[CUSTOM_ROW]) {
      mesh.update({ polyline: settingOf(CUSTOM_ROW) });
    }
  }
  if (params.equatorRow === CUSTOM_ROW) applyEquatorSetting();
};

const customFolder = pane.addFolder({ title: "custom row" });
customFolder
  .addBinding(params, "customDashArray", { label: "dashArray" })
  .on("change", applyCustomSetting);
customFolder
  .addBinding(params, "customCap", {
    label: "cap",
    options: { butt: "butt", round: "round", square: "square" },
  })
  .on("change", applyCustomSetting);

const CAMERA_TARGET = {
  lng: columnLng(1) + COLUMN_WIDTH + COLUMN_GAP / 2 - 0.004,
  lat: rowLat(ROW_COUNT / 2 - 1),
};
const cameraFolder = pane.addFolder({ title: "camera" });
cameraFolder.addButton({ title: "top down" }).on("click", () =>
  view.setCamera({
    ...CAMERA_TARGET,
    height: 4_200,
    heading: 0,
    pitch: -90,
    roll: 0,
  }),
);
// From the south at a low angle, where the far rows show the pattern's size
// following the distance.
cameraFolder.addButton({ title: "oblique" }).on("click", () =>
  view.setCamera({
    lng: CAMERA_TARGET.lng,
    lat: rowLat(ROW_COUNT) - 0.04,
    height: 2_800,
    heading: 0,
    pitch: -30,
    roll: 0,
  }),
);

const equatorRows: Record<string, number> = {};
for (let row = 0; row < ROW_COUNT; row++) {
  if (row >= END_ROW && row < CUSTOM_ROW) continue;
  equatorRows[labelOf(row)] = row;
}
const equatorFolder = pane.addFolder({ title: "equator" });
equatorFolder
  .addBinding(params, "equatorRow", { label: "dash", options: equatorRows })
  .on("change", applyEquatorSetting);
equatorFolder.addButton({ title: "globe" }).on("click", () =>
  view.setCamera({
    lng: 0,
    lat: 0,
    height: 20_000_000,
    heading: 0,
    pitch: -90,
    roll: 0,
  }),
);
// Low over the seam, looking east along the lines: their length starts again
// from zero there, after the equator's full length.
equatorFolder.addButton({ title: "seam (oblique)" }).on("click", () =>
  view.setCamera({
    lng: 179.97,
    lat: -0.004,
    height: 300,
    heading: 90,
    pitch: -12,
    roll: 0,
  }),
);
// Looking down at the start of the lines, and at their end about 40,000 km
// along them: the same view at both ends of the length.
for (const [title, lng] of [
  ["line start (top down)", -179.985],
  ["line end (top down)", 179.985],
] as const) {
  equatorFolder.addButton({ title }).on("click", () =>
    view.setCamera({
      lng,
      lat: 0,
      height: 1_500,
      heading: 0,
      pitch: -90,
      roll: 0,
    }),
  );
}
// From high up at a low angle: the pattern takes many sizes along the lines.
equatorFolder.addButton({ title: "far (oblique)" }).on("click", () =>
  view.setCamera({
    lng: 10,
    lat: -0.3,
    height: 30_000,
    heading: 90,
    pitch: -8,
    roll: 0,
  }),
);

view.setCamera({
  ...CAMERA_TARGET,
  height: 4_200,
  heading: 0,
  pitch: -90,
  roll: 0,
});
