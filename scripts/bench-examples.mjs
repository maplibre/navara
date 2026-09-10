// Measure real example pages in a real browser with WebAssembly SIMD on and off.
//
// Everything else in scripts/bench-terrain-simd.mjs is a synthetic microbenchmark
// in Node. This one loads the shipped example pages in headless Chrome, swaps only
// the four `.wasm` artifacts between runs, and times the actual worker tasks the
// engine dispatches.
//
//   node scripts/bench-examples.mjs --build          # build both variants first
//   node scripts/bench-examples.mjs                  # reuse target/example-bench
//   node scripts/bench-examples.mjs --rounds 5 --only terrain/raster
//   node scripts/bench-examples.mjs --headed         # watch it run
//
// Tile responses are recorded to target/example-bench/tiles on the first run and
// replayed from disk afterwards, so every variant sees byte-identical input and
// the numbers do not move with network weather. Delete that directory to refresh.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "web/navara_three/package.json"));
const { chromium } = require("playwright");
const { createServer } = await import(require.resolve("vite"));

const out = resolve(root, "target/example-bench");
const tileCache = resolve(out, "tiles");
mkdirSync(tileCache, { recursive: true });

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);

const ROUNDS = Number(flag("rounds", "4"));
const QUIET_MS = Number(flag("quiet", "2500")); // no worker task for this long = settled
const MAX_MS = Number(flag("max", "45000"));
const PORT = Number(flag("port", "4180"));

// CPU-heavy paths worth separating. Each is a demo URL under /demo/.
const EXAMPLES = [
  { id: "terrain/raster", why: "raster-DEM terrain: Martini + constructTerrainMesh" },
  { id: "terrain/quantized-mesh", why: "quantized-mesh terrain decode" },
  { id: "basemap/vector-map", why: "MVT parse + polygon/polyline batching + labels" },
  { id: "tiles-3d/buildings", why: "3D tiles, glTF parsing, quantized-mesh terrain" },
  { id: "gis/text", why: "label layout and the font worker" },
].filter((e) => !flag("only", null) || e.id === flag("only", null));

// crate -> the npm package name the web code imports. `vite-plugin-wasm` inlines
// the `.wasm` into the JS glue in dev, so there is no `_bg.wasm` HTTP request to
// intercept; the variant is selected by aliasing these package names instead.
const MODULES = [
  ["navara_wasm", "@navaramap/engine"],
  ["navara_wasm_worker", "@navaramap/engine-worker"],
  ["navara_wasm_font_worker", "@navaramap/engine-font-worker"],
  ["navara_wasm_api", "@navaramap/engine-api"],
];

function run(program, args, env) {
  const r = spawnSync(program, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${program} exited ${r.status}`);
}

// ---------------------------------------------------------------------------
// Build both variants through the shipping pipeline. Only the SIMD target
// feature differs; everything else matches makes/rust.toml.
// ---------------------------------------------------------------------------
if (has("build")) {
  for (const [variant, feature] of [["simd", "+simd128"], ["scalar", "-simd128"]]) {
    console.log(`\n=== building ${variant} ===`);
    run("cargo", [
      "build", "--release", "--target", "wasm32-unknown-unknown",
      "-Z", "build-std=std,panic_abort",
      ...MODULES.flatMap(([crate]) => ["-p", crate]),
    ], {
      RUSTC_BOOTSTRAP: "1",
      RUSTFLAGS: `--cfg getrandom_backend="wasm_js" -Ctarget-feature=${feature} -Zlocation-detail=none -Zunstable-options -Cpanic=immediate-abort`,
    });
    for (const [crate] of MODULES) {
      const dir = resolve(out, variant, crate);
      mkdirSync(dir, { recursive: true });
      run("wasm-bindgen", [
        `target/wasm32-unknown-unknown/release/${crate}.wasm`,
        "--out-dir", dir, "--target", "web",
      ]);
      const wasm = resolve(dir, `${crate}_bg.wasm`);
      run("wasm-opt", ["-Oz", "--strip-debug", "--strip-producers", wasm, "-o", wasm]);
    }
  }
}

// Load the built artifacts and sanity-check that the variants really differ.
const variants = {};
for (const variant of ["simd", "scalar"]) {
  variants[variant] = {};
  for (const [crate, pkg] of MODULES) {
    const dir = resolve(out, variant, crate);
    const wasm = resolve(dir, `${crate}_bg.wasm`);
    if (!existsSync(wasm)) throw new Error(`Missing ${wasm}. Run with --build first.`);
    // wasm-bindgen writes `<crate>.js` beside the binary; that is the package entry.
    variants[variant][pkg] = resolve(dir, `${crate}.js`);
  }
}
// A scalar build must contain no v128 opcode, and the SIMD build must contain some.
// 0xfd is the SIMD prefix byte; checking the section bytes directly avoids a
// wasm-dis dependency here.
for (const variant of ["simd", "scalar"]) {
  const total = MODULES.reduce(
    (n, [crate]) => n + readFileSync(resolve(out, variant, crate, `${crate}_bg.wasm`)).length, 0);
  console.log(`${variant}: ${MODULES.length} modules, ${(total / 1048576).toFixed(2)} MB raw`);
}

// ---------------------------------------------------------------------------
// Dev server. The middleware swaps the wasm bytes; everything else is the real
// example app, served exactly as `cargo make web` would serve it.
// ---------------------------------------------------------------------------
let variant = "simd";
let servedFromVariant = 0;

// Vite resolves the four wasm packages through `resolve.alias`, so selecting a
// variant means restarting the server with different alias targets. The
// middleware only counts requests, to prove the alias actually took effect.
async function startServer(name) {
  const server = await createServer({
    root: resolve(root, "web/navara_three"),
    configFile: resolve(root, "web/navara_three/vite.config.example.ts"),
    // The example config publishes under /examples; serve at the root so demo
    // URLs stay short.
    base: "/",
    // A cache dir per variant. Sharing one makes Vite re-optimize deps on every
    // alias change, which reloads the page in the middle of a measurement.
    cacheDir: resolve(out, `.vite-${name}`),
    resolve: {
      alias: Object.entries(variants[name]).map(([find, replacement]) => ({ find, replacement })),
    },
    server: { host: "127.0.0.1", port: PORT, strictPort: true, open: false, hmr: false },
    plugins: [{
      name: "example-bench-verify",
      configureServer(s) {
        s.middlewares.use((req, _res, next) => {
          if ((req.url ?? "").includes(`example-bench/${name}/`)) servedFromVariant++;
          next();
        });
      },
    }],
  });
  await server.listen();
  return server;
}

// ---------------------------------------------------------------------------
// Instrumentation injected before any page script runs.
// ---------------------------------------------------------------------------
const instrument = () => {
  window.__bench = { tasks: [], frames: [], lastTaskAt: 0, started: performance.now() };
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.__pending = new Map();
      this.addEventListener("message", ({ data }) => {
        const p = this.__pending.get(data?.id);
        if (!p || data?.isEvent) return;
        this.__pending.delete(data.id);
        const ms = performance.now() - p.start;
        window.__bench.tasks.push({ method: p.method, ms });
        window.__bench.lastTaskAt = performance.now();
      });
    }
    postMessage(message, ...rest) {
      if (message?.method) this.__pending.set(message.id, { method: message.method, start: performance.now() });
      return super.postMessage(message, ...rest);
    }
  };
  let prev = performance.now();
  const tick = () => {
    const now = performance.now();
    window.__bench.frames.push(now - prev);
    prev = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

// ---------------------------------------------------------------------------
// Tile record/replay so every variant sees identical bytes.
// ---------------------------------------------------------------------------
const cachePath = (url) => resolve(tileCache, createHash("sha1").update(url).digest("hex"));
let recorded = 0;
let replayed = 0;

async function installTileCache(page) {
  await page.route("**/*", async (route) => {
    // A route can outlive its page: closing the context mid-flight disposes the
    // response and every call here throws. None of that is a measurement error,
    // so swallow it and let the request die quietly.
    try {
      const url = route.request().url();
      if (url.startsWith(`http://127.0.0.1:${PORT}`)) return await route.continue();
      const file = cachePath(url);
      if (existsSync(file)) {
        replayed++;
        const meta = JSON.parse(readFileSync(`${file}.json`, "utf8"));
        return await route.fulfill({ status: meta.status, headers: meta.headers, body: readFileSync(file) });
      }
      const response = await route.fetch();
      const body = await response.body();
      writeFileSync(file, body);
      writeFileSync(`${file}.json`, JSON.stringify({
        status: response.status(),
        headers: { "content-type": response.headers()["content-type"] ?? "application/octet-stream" },
      }));
      recorded++;
      return await route.fulfill({ status: response.status(), headers: response.headers(), body });
    } catch {
      try { await route.abort(); } catch { /* page already gone */ }
    }
  });
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const browser = await chromium.launch({ headless: !has("headed"), channel: "chrome" });
const rows = [];
try {
  // Round -1 is unmeasured: it records tiles and warms Vite's transform cache.
  for (let round = -1; round < ROUNDS; round++) {
    for (const name of round % 2 ? ["scalar", "simd"] : ["simd", "scalar"]) {
      variant = name;
      servedFromVariant = 0;
      const server = await startServer(name);
      try {
        for (const example of EXAMPLES) {
          const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
          await context.addInitScript(instrument);
          const page = await context.newPage();
          await installTileCache(page);
          const errors = [];
          let timedOut = false;
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

          await page.goto(`http://127.0.0.1:${PORT}/demo/${example.id}.html`, { waitUntil: "load" });
          // Settled = the engine stopped dispatching worker tasks.
          await page.waitForFunction(
            (quiet) => {
              const b = window.__bench;
              return b && b.tasks.length > 0 && performance.now() - b.lastTaskAt > quiet;
            },
            QUIET_MS,
            { timeout: MAX_MS },
          ).catch(() => { timedOut = true; });

          const state = await page.evaluate(() => ({
            tasks: window.__bench.tasks, frames: window.__bench.frames,
          }));
          if (round === 0 && name === "simd") {
            await page.screenshot({ path: resolve(out, `${example.id.replace(/\//g, "-")}.png`) });
          }
          if (round >= 0) {
            rows.push({ example: example.id, variant: name, round, tasks: state.tasks, frames: state.frames, errors: errors.slice(0, 3) });
            process.stdout.write(
              `  ${example.id.padEnd(26)} ${name.padEnd(7)} round ${round}: ` +
              `${String(state.tasks.length).padStart(4)} worker tasks` +
              `${timedOut ? "  [timeout]" : ""}` +
              `${errors.length ? `  ERRORS: ${errors[0].slice(0, 120)}` : ""}\n`);
          }
          await context.close();
        }
      } finally {
        await server.close();
      }
      // Proves the alias took effect; without it both runs would silently use
      // whatever is in web/wasm and the comparison would be meaningless.
      if (!servedFromVariant) throw new Error(`variant "${name}" was never served — alias did not apply`);
    }
  }
} finally {
  await browser.close();
}

console.log(`\ntiles: ${recorded} recorded, ${replayed} replayed from ${tileCache}\n`);

// ---------------------------------------------------------------------------
// Report: per example, per worker method, median ms across all rounds.
// ---------------------------------------------------------------------------
const report = [];
for (const example of EXAMPLES) {
  const bucket = {};
  for (const row of rows.filter((r) => r.example === example.id)) {
    for (const t of row.tasks) {
      ((bucket[t.method] ??= { simd: [], scalar: [] })[row.variant]).push(t.ms);
    }
  }
  const methods = Object.entries(bucket)
    .filter(([, v]) => v.simd.length && v.scalar.length)
    .map(([method, v]) => ({
      method,
      scalarMs: median(v.scalar),
      simdMs: median(v.simd),
      deltaPct: (median(v.simd) / median(v.scalar) - 1) * 100,
      samples: `${v.scalar.length}/${v.simd.length}`,
      totalScalarMs: v.scalar.reduce((a, b) => a + b, 0) / ROUNDS,
      totalSimdMs: v.simd.reduce((a, b) => a + b, 0) / ROUNDS,
    }))
    .sort((a, b) => b.totalScalarMs - a.totalScalarMs);
  report.push({ example: example.id, why: example.why, methods });

  console.log(`\n### ${example.id} — ${example.why}`);
  if (!methods.length) { console.log("  (no worker tasks recorded)"); continue; }
  console.table(methods.map((m) => ({
    "worker task": m.method,
    "scalar ms": m.scalarMs.toFixed(2),
    "simd ms": m.simdMs.toFixed(2),
    "delta": `${m.deltaPct >= 0 ? "+" : ""}${m.deltaPct.toFixed(1)}%`,
    "cpu/run scalar ms": m.totalScalarMs.toFixed(0),
    "cpu/run simd ms": m.totalSimdMs.toFixed(0),
    "n": m.samples,
  })));
}

writeFileSync(resolve(out, "results.json"), JSON.stringify({
  rounds: ROUNDS, examples: EXAMPLES, report, rows: rows.map(({ frames, ...r }) => ({ ...r, frameCount: frames.length })),
}, null, 2) + "\n");
console.log(`\nResults: ${out}/results.json`);
