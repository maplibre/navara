import ThreeView, { Color, vector3ToGeodetic } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";
import { Matrix3, Matrix4, Vector3 } from "three";
import { Pane } from "tweakpane";

import { DATASETS } from "./datasets";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin());
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);
await view.init();

view.atmosphere.date = new Date("2026-07-16T17:00:00Z");
view.addLight({ ambient: { intensity: 0.6 } });
view.addLight({ sun: { intensity: 1.8 } });

const basemap = await tilejson.addSource({
  type: "raster-tile",
  url: "https://papers.reearth.land/styles/grayscale/tilejson.json",
});
view.addLayer({ type: "raster", source: basemap });

const query = new URLSearchParams(location.search);
const params = {
  dataset: query.get("ds") ?? `${DATASETS[0].group}/${DATASETS[0].name}`,
  url: query.get("url") ?? "",
  note: "",
  asset: "",
  features: 0,
  picked: "",
};

// Kept across dataset switches.
const material = {
  pointSize: 4,
  color: 0xffffff,
  opacity: 1,
  transparent: false,
  depthWrite: true,
};
const modelProps = () => ({
  ...material,
  color: new Color().setHex(material.color),
});

// Emissive, so the highlight does not hide the feature's own color.
const HIGHLIGHT = new Color().setHex(0x00ffff);
const NONE = new Color().setHex(0x000000);
let pickedBatchId: number | undefined;

let source: ReturnType<typeof view.addSource> | undefined;
let layer: ReturnType<typeof view.addLayer> | undefined;

type TilesetJson = {
  asset?: { version?: string };
  root: {
    transform?: number[];
    boundingVolume: { region?: number[]; box?: number[]; sphere?: number[] };
  };
};

/** Frames the root bounding volume, honoring the root transform. */
function frameTileset(tileset: TilesetJson) {
  const { boundingVolume: bv, transform } = tileset.root;
  const m = transform ? new Matrix4().fromArray(transform) : new Matrix4();
  let target: { lng: number; lat: number; height: number };
  let radius: number;
  if (bv.region) {
    const [w, s, e, n, minH, maxH] = bv.region;
    const lat = (s + n) / 2;
    target = {
      lng: (((w + e) / 2) * 180) / Math.PI,
      lat: (lat * 180) / Math.PI,
      height: (minH + maxH) / 2,
    };
    const R = 6378137;
    radius = Math.hypot((e - w) * R * Math.cos(lat), (n - s) * R) / 2;
  } else if (bv.box) {
    const [x, y, z] = bv.box;
    const center = new Vector3(x, y, z).applyMatrix4(m);
    target = vector3ToGeodetic(center);
    const linear = new Matrix3().setFromMatrix4(m);
    const box = bv.box;
    radius = Math.hypot(
      ...[3, 6, 9].map((i) =>
        new Vector3(box[i], box[i + 1], box[i + 2])
          .applyMatrix3(linear)
          .length(),
      ),
    );
  } else if (bv.sphere) {
    const [x, y, z, r] = bv.sphere;
    target = vector3ToGeodetic(new Vector3(x, y, z).applyMatrix4(m));
    const scale = new Vector3().setFromMatrixScale(m);
    radius = r * Math.max(scale.x, scale.y, scale.z);
  } else {
    return;
  }
  view.setCamera({
    ...target,
    distance: Math.max(radius * 2.5, 30),
    heading: 0,
    pitch: -35,
    roll: 0,
  });
}

async function load(url: string, note = "") {
  layer?.delete();
  source?.delete();
  params.note = note;
  params.asset = "";
  params.features = 0;
  params.picked = "";
  pickedBatchId = undefined;
  pane.refresh();

  source = view.addSource({ type: "3d-tiles", url });
  layer = view.addLayer({ type: "3d-tiles", source, model: modelProps() });
  layer.on("featureCreated", () => {
    params.features++;
  });
  layer.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(({ batchId }) => {
      const picked = batchId === pickedBatchId;
      return {
        emissive: picked ? HIGHLIGHT : NONE,
        emissiveIntensity: picked ? 0.6 : 0,
      };
    });
  });

  try {
    const tileset = (await (await fetch(url)).json()) as TilesetJson;
    params.asset = tileset.asset?.version ?? "?";
    frameTileset(tileset);
  } catch (e) {
    params.asset = `fetch failed: ${e}`;
  }
  pane.refresh();
}

function loadSelected() {
  const ds = DATASETS.find((d) => `${d.group}/${d.name}` === params.dataset);
  if (!ds) {
    return;
  }
  params.url = "";
  history.replaceState(null, "", `?ds=${encodeURIComponent(params.dataset)}`);
  void load(ds.url, ds.note);
}

const pane = new Pane({ title: "3D Tiles" });
pane
  .addBinding(params, "dataset", {
    options: Object.fromEntries(
      DATASETS.map((d) => [`${d.group} / ${d.name}`, `${d.group}/${d.name}`]),
    ),
  })
  .on("change", loadSelected);
pane.addBinding(params, "note", { readonly: true });
pane.addBinding(params, "asset", { readonly: true, label: "version" });
pane.addBinding(params, "features", { readonly: true, interval: 500 });
pane.addBinding(params, "picked", {
  readonly: true,
  multiline: true,
  rows: 10,
  label: "clicked",
});
const materialFolder = pane.addFolder({ title: "Material" });
materialFolder.addBinding(material, "pointSize", { min: 1, max: 20, step: 1 });
materialFolder.addBinding(material, "color", { color: { type: "int" } });
materialFolder.addBinding(material, "opacity", { min: 0, max: 1, step: 0.01 });
materialFolder.addBinding(material, "transparent");
materialFolder.addBinding(material, "depthWrite");
materialFolder.on("change", () => layer?.update({ model: modelProps() }));
pane.addBinding(params, "url", { label: "custom url" });
pane.addButton({ title: "Load custom url" }).on("click", () => {
  if (!params.url) {
    return;
  }
  history.replaceState(null, "", `?url=${encodeURIComponent(params.url)}`);
  void load(params.url);
});

view.on("featureClick", (info) => {
  const hit = info && info.layerId === layer?.id ? info : undefined;
  params.picked = hit
    ? JSON.stringify({ batchId: hit.batchId, ...hit.properties }, null, 1)
    : "";
  pane.refresh();
  if (hit?.batchId !== pickedBatchId) {
    pickedBatchId = hit?.batchId;
    layer?.forceUpdate();
  }
});

if (params.url) {
  void load(params.url);
} else {
  loadSelected();
}
