import ThreeView, { Color, type Layer } from "@navaramap/three";
import type { AmbientLightDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import type { FeatureCollection } from "geojson";
import { Pane } from "tweakpane";

import { TILE_DATASETS } from "../../../helpers/constants";
import { addHidePaneKeyShortcut } from "../../../helpers/control";

import {
  BROKEN_IMAGE_URL,
  generateDefaultImage,
  generateImagePool,
} from "./images";

// Fixed grid footprint in degrees: density scales with feature count, so the
// same camera framing works from 100 up to 40,000 billboards.
const CENTER = { lng: 139.76, lat: 35.68 };
const EXTENT = { lng: 0.6, lat: 0.45 };

const buildGrid = (count: number): FeatureCollection => {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const features = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const lng =
      CENTER.lng + (cols > 1 ? (col / (cols - 1) - 0.5) * EXTENT.lng : 0);
    const lat =
      CENTER.lat + (rows > 1 ? (row / (rows - 1) - 0.5) * EXTENT.lat : 0);
    features.push({
      type: "Feature" as const,
      properties: { idx: i },
      geometry: { type: "Point" as const, coordinates: [lng, lat] },
    });
  }
  return { type: "FeatureCollection", features };
};

export const run = async (view: ThreeView<DefaultDescriptions>) => {
  view.addPlugin(new DefaultPlugin());

  await view.init();

  view.addLight<AmbientLightDesc>({
    ambient: {
      intensity: 0.5,
    },
  });

  const osmSource = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  });
  view.addLayer({
    type: "raster",
    source: osmSource,
  });

  view.setCamera({
    lng: CENTER.lng,
    lat: CENTER.lat - 0.55,
    height: 60000,
    heading: 0,
    pitch: -50,
    roll: 0,
  });

  const params = {
    count: 2500,
    size: 48,
    sizeInMeters: false,
    mode: "cycle" as "cycle" | "random" | "default-only",
    poolSize: 24,
    overrideRatio: 1.0,
    varySize: false,
    includeBroken: false,
  };

  const stats = { fps: 0, picked: "click a billboard" };

  // Features whose per-instance image was reset by clicking them; the
  // evaluator returns `image: null` for these, reverting them to the
  // material's default `url`.
  const clearedIdx = new Set<number>();

  const defaultImageUrl = generateDefaultImage();
  let imagePool = generateImagePool(params.poolSize);

  // Grids are cached per count so material-only tweaks (which replace the
  // whole layer config, data included) don't rebuild the FeatureCollection.
  const gridCache = new Map<number, FeatureCollection>();
  const gridFor = (count: number): FeatureCollection => {
    let grid = gridCache.get(count);
    if (!grid) {
      grid = buildGrid(count);
      gridCache.set(count, grid);
    }
    return grid;
  };

  const buildBillboardMaterial = () => ({
    color: new Color().setStyle("#ffffff"),
    size: params.size,
    sizeInMeters: params.sizeInMeters,
    height: 1,
    clampToGround: true,
    depthTest: true,
    alphaTest: 0.1,
    transparent: true,
    url: defaultImageUrl,
    anchor: "bottom" as const,
    offsetDepth: true,
  });

  // Decide each feature's image from the current UI state. `null` clears any
  // per-instance override and reverts the feature to the material's `url`.
  const pickImageUrl = (idx: number): string | null => {
    if (params.mode === "default-only") return null;
    if (clearedIdx.has(idx)) return null;
    if (idx >= Math.floor(params.overrideRatio * params.count)) return null;
    if (params.includeBroken && idx % 13 === 0) return BROKEN_IMAGE_URL;
    if (imagePool.length === 0) return null;
    const i =
      params.mode === "random"
        ? Math.floor(Math.random() * imagePool.length)
        : idx % imagePool.length;
    return imagePool[i]?.url ?? null;
  };

  const attachEvaluator = (l: Layer) => {
    // No dedupe set on purpose: every `forceUpdate()` re-runs the evaluator
    // for all features.
    l.on("featureUpdated", ({ evaluator }) => {
      evaluator.evaluate(
        ({ properties }) => {
          const idx = Number(properties?.["idx"]);
          if (!Number.isFinite(idx)) return {};

          // Per-instance size: a negative value resets the instance to the
          // material-level size, mirroring the `image: null` reset semantics.
          const size = params.varySize
            ? params.size * (0.5 + (idx % 7) * 0.25)
            : -1;

          return { image: pickImageUrl(idx), size };
        },
        { filters: ["idx"] },
      );
    });
  };

  let gridSource: ReturnType<typeof view.addSource> | undefined;

  const addBillboardLayer = () => {
    gridSource = view.addSource({
      type: "geojson",
      data: gridFor(params.count),
    });
    const l = view.addLayer({
      type: "vector",
      source: gridSource,
      billboard: buildBillboardMaterial(),
    });
    attachEvaluator(l);
    return l;
  };

  let layer: Layer | undefined = addBillboardLayer();

  // Count changes re-point the source data; material tweaks update the layer.
  // Resending both mirrors the old full-descriptor update semantics.
  const rebuildLayer = () => {
    gridSource?.update({ type: "geojson", data: gridFor(params.count) });
    layer?.update({ billboard: buildBillboardMaterial() });
  };
  const restyle = () => layer?.forceUpdate();

  // Click a billboard to toggle a per-instance image reset: the first click
  // reverts it to the default image (`image: null`), the next restores its
  // per-feature image.
  view.on("featureClick", (info) => {
    const idx = Number(info?.properties?.["idx"]);
    if (!Number.isFinite(idx)) return;
    if (clearedIdx.has(idx)) {
      clearedIdx.delete(idx);
      stats.picked = `#${idx}: override restored`;
    } else {
      clearedIdx.add(idx);
      stats.picked = `#${idx}: reset to default`;
    }
    restyle();
  });

  // Control panel
  const pane = new Pane({ title: "Multi-image billboard" });
  addHidePaneKeyShortcut(pane);

  const layerFolder = pane.addFolder({ title: "Layer" });
  layerFolder
    .addBinding(params, "count", {
      options: { 100: 100, 400: 400, 2500: 2500, 10000: 10000, 40000: 40000 },
    })
    .on("change", () => {
      clearedIdx.clear();
      rebuildLayer();
    });
  const toggleBtn = layerFolder.addButton({
    title: "Remove layer",
    label: "layer",
  });
  toggleBtn.on("click", () => {
    if (layer) {
      view.deleteLayerById(layer.id);
      // Source is reference-counted; free it so toggling can't stack orphans.
      gridSource?.delete();
      gridSource = undefined;
      layer = undefined;
      toggleBtn.title = "Add layer";
    } else {
      layer = addBillboardLayer();
      toggleBtn.title = "Remove layer";
    }
  });

  const materialFolder = pane.addFolder({ title: "Material (whole update)" });
  materialFolder
    .addBinding(params, "size", { min: 2, max: 2000, step: 1 })
    .on("change", rebuildLayer);
  materialFolder
    .addBinding(params, "sizeInMeters")
    .on("change", ({ value }) => {
      // Keep the on-screen size sensible when switching units.
      params.size = value ? 600 : 48;
      pane.refresh();
      rebuildLayer();
    });

  const imagesFolder = pane.addFolder({ title: "Per-feature images" });
  imagesFolder
    .addBinding(params, "mode", {
      options: {
        "cycle (idx % pool)": "cycle",
        "random each update": "random",
        "default only (reset all)": "default-only",
      },
    })
    .on("change", restyle);
  imagesFolder
    .addBinding(params, "poolSize", { min: 1, max: 512, step: 1 })
    .on("change", ({ value }) => {
      imagePool = generateImagePool(value);
      restyle();
    });
  imagesFolder
    .addBinding(params, "overrideRatio", { min: 0, max: 1, step: 0.01 })
    .on("change", restyle);
  imagesFolder.addBinding(params, "varySize").on("change", restyle);
  imagesFolder.addBinding(params, "includeBroken").on("change", restyle);
  imagesFolder
    .addButton({ title: "Restore clicked resets", label: "resets" })
    .on("click", () => {
      clearedIdx.clear();
      stats.picked = "click a billboard";
      restyle();
    });

  // Engine memory readout (view.memoryStats(), fed by the WASM memory
  // ledger). The billboard mesh reports its measured atlas footprint (CPU
  // pixel buffer + GPU texture) per feature and the ledger folds it into the
  // owning tile's GPU cost, so atlas growth shows up in "GPU est." — watch it
  // react to poolSize changes and layer add/remove.
  const memoryFolder = pane.addFolder({ title: "Memory" });
  const memory = { cpuMB: 0, gpuMB: 0 };
  setInterval(() => {
    const memStats = view.memoryStats();
    if (!memStats) return;
    memory.cpuMB =
      (memStats.bufferTotalBytes +
        memStats.externalBufferBytes +
        memStats.externalCpuBytes) /
      (1024 * 1024);
    memory.gpuMB = memStats.gpuBytesEst / (1024 * 1024);
  }, 500);
  memoryFolder.addBinding(memory, "cpuMB", {
    readonly: true,
    label: "CPU MB",
    format: (v) => v.toFixed(2),
  });
  memoryFolder.addBinding(memory, "gpuMB", {
    readonly: true,
    label: "GPU est. MB",
    format: (v) => v.toFixed(2),
  });

  view.attribution?.add([TILE_DATASETS.openstreetmap]);
};
