// Browser experiment against the real tile-worker pipeline. See guide/SIMD.md.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "web/navara_three/package.json"));
const { chromium } = require("playwright");
const { createServer } = await import(require.resolve("vite"));
const sharp = require("sharp");
const out = resolve(root, "target/worker-speed-experiment");
mkdirSync(out, { recursive: true });
if (process.argv.includes("--build")) {
  const run = (program, args) => {
    const result = spawnSync(program, args, { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${program} failed: ${result.status}`);
  };
  run("cargo", ["make", "build-all"]);
  mkdirSync(resolve(out, "baseline"), { recursive: true });
  for (const file of ["navara_wasm_worker.js", "navara_wasm_worker_bg.wasm"]) {
    copyFileSync(resolve(root, "web/wasm/navara_engine_worker", file), resolve(out, "baseline", file));
  }
  run("cargo", ["make", "build-rust-worker-speed"]);
  run("wasm-bindgen", [
    "target/wasm32-unknown-unknown/release-worker-speed/navara_wasm_worker.wasm",
    "--out-dir", resolve(out, "speed"), "--target", "web",
  ]);
  const wasm = resolve(out, "speed/navara_wasm_worker_bg.wasm");
  run("wasm-opt", ["-Oz", "--strip-debug", "--strip-producers", wasm, "-o", wasm]);
}
const variants = Object.fromEntries(["baseline", "speed"].map(name => {
  const bytes = readFileSync(resolve(out, name, "navara_wasm_worker_bg.wasm"));
  return [name, { bytes, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length }];
}));
// The original wrapper can supply unused imports, but must provide every import
// required by the candidate. The browser run also checks initialization/errors.
const imports = bytes => WebAssembly.Module.imports(new WebAssembly.Module(bytes))
  .map(i => `${i.module}:${i.name}:${i.kind}`);
const baselineImports = new Set(imports(variants.baseline.bytes));
if (imports(variants.speed.bytes).some(i => !baselineImports.has(i))) {
  throw new Error("Candidate needs new imports: rebuild the browser wrapper before comparing");
}

// Deterministic rugged terrain isolates CPU/worker/rendering costs from internet
// latency. Every requested tile receives this same synthetic 256x256 GSI DEM.
const pixels = Buffer.alloc(256 * 256 * 4);
for (let y = 0; y < 256; y++) {
  for (let x = 0; x < 256; x++) {
    const height = 1500 + 600 * Math.sin(x / 7) * Math.cos(y / 9)
      + 300 * Math.sin((x + y) / 3);
    const code = Math.round(height * 100);
    const p = (y * 256 + x) * 4;
    pixels[p] = code >> 16;
    pixels[p + 1] = (code >> 8) & 255;
    pixels[p + 2] = code & 255;
    pixels[p + 3] = 255;
  }
}
const png = await sharp(pixels, { raw: { width: 256, height: 256, channels: 4 } }).png().toBuffer();
// The fixed camera resolves 7-8 Martini surfaces above the vertex threshold;
// wait for 6 so the run completes even if one tile lands late.
const TARGET_TILES = 6;
let variant = "baseline";
let wasmRequests = 0;
const scene = `
import ThreeView, { JAPAN_GSI_ELEVATION_DECODER } from '/src/index.ts';
import { DefaultPlugin } from '/@fs/${root}/web/navara_three_default_plugin/src/index.ts';
const start = performance.now();
const view = new ThreeView({ container: document.body, segments: 16, maxSse: 8,
  defaultAttribution: false, pixelRatio: 1, picking: false });
view.addPlugin(new DefaultPlugin());
await view.init();
view.setCamera({lng:138.73,lat:35.36,height:10000,heading:0,pitch:-90,roll:0});
const ready = performance.now();
const seen = new Set();
const counts = [];
const render = view._renderer.renderBufferDirect;
window.bench = { initMs: ready-start, tileTimes: [], counts, done: false };
view._renderer.renderBufferDirect = function(camera, scene, geometry, material, object, group) {
  const result = render.call(this, camera, scene, geometry, material, object, group);
  // The synthetic Martini surface has thousands of vertices; the initial
  // ellipsoid/fallback grid (16 segments, 289 vertices) is excluded.
  if (object.tileHandler && !seen.has(geometry.uuid)) {
    const count = geometry.getAttribute('position')?.count ?? 0;
    counts.push(count);
    if (count > 5000) {
      seen.add(geometry.uuid);
      window.bench.tileTimes.push(performance.now()-ready);
      if (seen.size >= ${TARGET_TILES}) window.bench.done = true;
    }
  }
  return result;
};
const source = view.addSource({type:'raster-dem',url:location.origin+'/__dem/{z}/{x}/{y}.png',
  elevationDecoder:JAPAN_GSI_ELEVATION_DECODER(),minZoom:6,maxZoom:14});
view.addLayer({type:'terrain',source,terrain:{skirt:true}});
window.benchView = view;
`;
const server = await createServer({
  base: "/",
  root: resolve(root, "web/navara_three"),
  configFile: resolve(root, "web/navara_three/vite.config.example.ts"),
  server: { host: "127.0.0.1", port: 4179, strictPort: true, open: false, hmr: false },
  plugins: [{
    name: "worker-speed-experiment",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (url.includes("navara_wasm_worker_bg.wasm")) {
          wasmRequests++;
          res.setHeader("Content-Type", "application/wasm");
          res.setHeader("Cache-Control", "no-store");
          res.end(variants[variant].bytes);
        } else if (url.startsWith("/__dem/")) {
          res.setHeader("Content-Type", "image/png");
          res.end(png);
        } else if (url === "/__worker-speed-scene.js") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(scene);
        } else if (url === "/__worker-speed") {
          res.setHeader("Content-Type", "text/html");
          res.end('<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}</style><script type="module" src="/__worker-speed-scene.js"></script>');
        } else if (url === "/favicon.ico") {
          res.statusCode = 204;
          res.end();
        } else next();
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const rows = [];
  // Discard the first pair to warm Vite transforms. Fresh contexts for each run.
  for (let round = -1; round < 7; round++) {
    for (const name of round % 2 ? ["speed", "baseline"] : ["baseline", "speed"]) {
      variant = name;
      wasmRequests = 0;
      const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
      await context.addInitScript(() => {
        window.workerTimings = [];
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            this.pendingTasks = new Map();
            this.addEventListener("message", ({ data }) => {
              const pending = this.pendingTasks.get(data?.id);
              if (!pending || data.isEvent) return;
              this.pendingTasks.delete(data.id);
              window.workerTimings.push({ method: pending.method, ms: performance.now() - pending.start });
            });
          }
          postMessage(message, ...args) {
            if (message?.method) this.pendingTasks.set(message.id, { method: message.method, start: performance.now() });
            return super.postMessage(message, ...args);
          }
        };
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", e => {
        errors.push(e.stack ?? e.message);
        console.error(e.stack ?? e.message);
      });
      page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
      page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
      await page.goto("http://127.0.0.1:4179/__worker-speed");
      if (round === -1) {
        // Let Vite finish discovering dependencies before collecting samples.
        await page.waitForTimeout(8000);
        errors.length = 0;
        await page.reload();
      }
      try {
        await page.waitForFunction(() => window.bench?.done, undefined, { timeout: 60000 });
      } catch (error) {
        console.error({ errors, state: await page.evaluate(() => ({...window.bench, counts: [...new Set(window.bench?.counts)], tasks: window.workerTimings})) });
        throw error;
      }
      const state = await page.evaluate(() => ({ ...window.bench, workerTimings: window.workerTimings }));
      if (errors.length) throw new Error(errors.join("\n"));
      if (!wasmRequests) throw new Error("Worker artifact was not intercepted");
      if (round >= 0) {
        const row = { variant: name, round, initMs: state.initMs,
          firstTerrainMs: state.tileTimes[0],
          lastTerrainMs: state.tileTimes[TARGET_TILES - 1],
          vertexCounts: [...new Set(state.counts)], wasmRequests, workerTimings: state.workerTimings };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
      if (round === 0) await page.screenshot({ path: resolve(out, `${name}.png`) });
      await context.close();
    }
  }
  writeFileSync(resolve(out, "browser-results.json"), JSON.stringify({
    browser: browser.version(), viewport: [960, 640], fixture: "synthetic GSI DEM",
    sizes: Object.fromEntries(Object.entries(variants).map(([name, {raw, gzip}]) => [name, {raw, gzip}])), rows,
  }, null, 2) + "\n");
} finally {
  await browser?.close();
  await server.close();
}
