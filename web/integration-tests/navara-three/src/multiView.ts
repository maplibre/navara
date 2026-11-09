import ThreeView, {
  Color,
  fetchFontFamilyFromCss,
  JAPAN_GSI_ELEVATION_DECODER,
} from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

// Several ThreeViews on one page, driven through their lifecycle against the
// built packages: concurrent init, disposing one view, disposing a view while
// it initializes, disposing every view, disposing a view while the pool warms
// up, and initializing again. Each step is checked through the probe installed
// by multi-view.html; the report shows PASS or FAIL per check and is mirrored
// to `window.__result`.

type View = ThreeView<DefaultDescriptions>;

type Probe = {
  /** Main-thread WASM instantiations by module. */
  wasm: Record<string, number>;
  workers: {
    live: Map<number, "tile" | "font">;
    created: number;
    terminated: number;
  };
  errors: string[];
};

type Check = { name: string; pass: boolean; detail: unknown };

type Result = { checks: Check[]; passed?: boolean; done: boolean };

const page = window as unknown as { __probe: Probe; __result: Result };

const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@800";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} is missing from multi-view.html`);
  return found;
}

const probe = page.__probe;
const report = element("report");
const result: Result = { checks: [], done: false };
page.__result = result;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function liveWorkers() {
  const live = { tile: 0, font: 0 };
  for (const kind of probe.workers.live.values()) live[kind]++;
  return live;
}

function check(name: string, pass: boolean, detail: unknown) {
  result.checks.push({ name, pass, detail });
  render();
}

function render() {
  const { checks, passed, done } = result;
  const lines = checks.map(
    (c) =>
      `${c.pass ? "PASS" : "FAIL"}  ${c.name}  ${JSON.stringify(c.detail)}`,
  );
  const header = done ? (passed ? "ALL PASSED" : "FAILED") : "running…";
  report.textContent = [header, ...lines].join("\n");
}

function createView(container: HTMLElement, workerPoolSize?: number): View {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;display:block;";
  container.replaceChildren(canvas);
  const view = new ThreeView<DefaultDescriptions>({ canvas, workerPoolSize });
  view.addPlugin(new DefaultPlugin());
  return view;
}

function addContent(view: View) {
  view.addLight({ ambient: { intensity: 0.8 } });
  view.addLight({ sun: { intensity: 1.5 } });
  const dem = view.addSource({
    type: "raster-dem",
    url: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
    elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
    maxZoom: 15,
    minZoom: 6,
  });
  view.addLayer({ type: "terrain", source: dem });
  const photo = view.addSource({
    type: "raster-tile",
    url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    maxZoom: 18,
  });
  view.addLayer({ type: "raster", source: photo });

  // A label, so each view also runs its font worker.
  const label = view.addSource({
    type: "geojson",
    data: {
      type: "Feature",
      properties: { name: "東京駅 Tokyo Station" },
      geometry: { type: "Point", coordinates: [139.7671, 35.6812] },
    },
  });
  const labels = view.addLayer({
    type: "vector",
    source: label,
    text: {
      font: "MapFont",
      color: new Color().setStyle("#ffffff"),
      size: 32,
      sizeInMeters: false,
      height: 100,
      depthTest: false,
      outlineColor: new Color().setStyle("#000000"),
      outlineWidth: 4,
    },
  });
  labels.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => ({ text: properties?.["name"] as string }),
      { filters: ["name"] },
    );
  });

  view.setCamera({
    lng: 139.7671,
    lat: 35.6812,
    distance: 2000,
    heading: 50,
    pitch: -35,
    roll: 0,
  });
  view.attribution?.add([
    {
      attribution:
        "Geospatial Information Authority of Japan Tiles - Latest Nationwide Photo (Seamless), Elevation (DEM)",
      attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
    },
    {
      attribution: "Noto Sans JP (SIL Open Font License)",
      attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+JP",
    },
  ]);
}

async function main() {
  const left = element("left");
  const right = element("right");

  // 1. Two views and the CSS font parser initialize the WASM modules at once.
  //    The views ask for different pool sizes; the first one's wins.
  const a = createView(left, 2);
  const b = createView(right, 3);
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
    warn(...args);
  };
  const [, , family] = await Promise.all([
    a.init(),
    b.init(),
    fetchFontFamilyFromCss("MapFont", FONT_CSS),
  ]).finally(() => {
    console.warn = warn;
  });
  check(
    "concurrent init instantiates each main-thread WASM module once",
    probe.wasm["engine"] === 1 && probe.wasm["engine-api"] === 1,
    { ...probe.wasm },
  );
  const poolSizes = await Promise.all(
    [a, b].map(
      async (view) =>
        (await view.workerMemoryStats())?.tileWorkers?.perSlot.length,
    ),
  );
  const expectedPoolSize = Math.min(2, navigator.hardwareConcurrency);
  // With two cores both sizes clamp to 2, so the pool has nothing to warn about.
  const expectWarning = Math.min(3, navigator.hardwareConcurrency) > 2;
  const warned = warnings.some((w) =>
    w.includes("shared worker pool keeps its size"),
  );
  check(
    "the first view's workerPoolSize sizes the shared pool",
    poolSizes.every((size) => size === expectedPoolSize) &&
      warned === expectWarning,
    { poolSizes, expectedPoolSize, expectWarning, warnings },
  );
  for (const view of [a, b]) {
    view.addFontFamily(family);
    addContent(view);
  }
  await sleep(10_000);
  const streaming = liveWorkers();
  check(
    "views share one tile-worker pool",
    streaming.tile > 0 && streaming.tile <= navigator.hardwareConcurrency,
    { ...streaming, hardwareConcurrency: navigator.hardwareConcurrency },
  );

  // 2. Disposing one view keeps the pool for the other.
  a.dispose();
  await sleep(1_500);
  const afterOne = liveWorkers();
  check(
    "disposing one view keeps the shared pool",
    afterOne.tile > 0,
    afterOne,
  );

  // 3. Disposing a view while it initializes: init settles without an error
  //    and leaves no workers behind.
  const pending = createView(left);
  const init = pending.init();
  pending.dispose();
  let initError: string | null = null;
  try {
    await init;
  } catch (e) {
    initError = String(e);
  }
  await sleep(1_500);
  const afterPending = liveWorkers();
  check(
    "dispose during init settles init and leaks no worker",
    initError === null && afterPending.tile === afterOne.tile,
    { initError, before: afterOne, after: afterPending },
  );

  // 4. Disposing the last view terminates every worker.
  b.dispose();
  await sleep(1_500);
  const afterAll = liveWorkers();
  check(
    "disposing every view terminates all workers",
    afterAll.tile === 0 && afterAll.font === 0,
    afterAll,
  );

  // 5. Disposing the view that created the pool right after its init, while
  //    the pool still warms its workers in the background.
  const warming = createView(left);
  await warming.init();
  warming.dispose();
  await sleep(1_500);
  const afterWarming = liveWorkers();
  check(
    "dispose while the pool warms up leaks no worker",
    afterWarming.tile === 0 && afterWarming.font === 0,
    afterWarming,
  );

  // 6. A view initialized after every view was disposed starts a new pool and
  //    reuses the already instantiated WASM modules.
  const c = createView(left);
  await c.init();
  c.addFontFamily(family);
  addContent(c);
  await sleep(8_000);
  const reinit = liveWorkers();
  check(
    "a view after all were disposed starts a new pool",
    reinit.tile > 0 && probe.wasm["engine"] === 1,
    { ...reinit, wasm: { ...probe.wasm } },
  );

  check("no uncaught errors", probe.errors.length === 0, probe.errors);
}

main()
  .catch((e: unknown) => {
    check("scenario completes", false, String(e));
  })
  .finally(() => {
    result.passed = result.checks.every((c) => c.pass);
    result.done = true;
    render();
    console.log(
      `Navara multi-view integration test ${result.passed ? "passed" : "failed"}`,
    );
  });
