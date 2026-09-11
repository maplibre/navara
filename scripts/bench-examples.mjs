// Compare complete example frame CPU time with WebAssembly SIMD off and on.
// node scripts/bench-examples.mjs --build --headed --rounds 5
// See guide/SIMD.md. All reported times are milliseconds; positive improvement
// means SIMD was faster. --frames remains accepted for older commands.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { compare, comparisonRow, mean, percentile } from "./bench-stats.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "web/navara_three/package.json"));
const { chromium } = require("playwright");
const { createServer } = await import(require.resolve("vite"));

const out = resolve(root, "target/example-bench");
const tileCache = resolve(out, "tiles");
mkdirSync(tileCache, { recursive: true });

// Two runs at once corrupt each other: they share the per-variant Vite cache
// dirs, so each invalidates the other's pre-bundled deps mid-measurement, and
// they overwrite the same result files. The symptom is a page that reloads
// while being measured, which surfaces as the variant-not-served check below.
// Refuse to start instead.
const LOCK = resolve(out, ".bench.lock");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
if (existsSync(LOCK)) {
  const owner = Number(readFileSync(LOCK, "utf8").trim());
  if (alive(owner)) {
    console.error(
      `Another benchmark run is in progress (pid ${owner}).\n` +
        `Wait for it, or stop it and delete ${LOCK}.`,
    );
    process.exit(1);
  }
  // Owner is gone — a previous run was killed before it could clean up.
}
writeFileSync(LOCK, String(process.pid));
const releaseLock = () => {
  try {
    if (
      existsSync(LOCK) &&
      readFileSync(LOCK, "utf8").trim() === String(process.pid)
    )
      rmSync(LOCK);
  } catch {
    // Nothing useful to do while exiting.
  }
};
process.on("exit", releaseLock);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    releaseLock();
    process.exit(130);
  });

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);

const ROUNDS = Number(flag("rounds", "5"));
const QUIET_MS = Number(flag("quiet", "2500")); // no worker task for this long = settled
const MAX_MS = Number(flag("max", "90000"));
// 0 asks the OS for a free port, so a second run — or a `cargo make web` dev
// server — cannot collide with this one. Pass --port to pin it.
const PORT = Number(flag("port", "0"));
/** Port the dev server actually bound to; set by `startServer`. */
let activePort = PORT;
// Every frame includes the complete engine update and render submission.
const FRAME_WINDOW_MS = Number(flag("frame-window", "8000"));
const WORKERS = Number(flag("workers", "4"));
for (const [name, value] of Object.entries({
  rounds: ROUNDS,
  quiet: QUIET_MS,
  max: MAX_MS,
  "frame-window": FRAME_WINDOW_MS,
  workers: WORKERS,
})) {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`--${name} must be a positive integer`);
}

// CPU-heavy paths worth separating. Each is a demo URL under /demo/.
const ALL_EXAMPLES = [
  { id: "terrain/raster", why: "terrain and globe coordinate processing" },
  {
    id: "basemap/vector-map",
    why: "vector geometry, labels and tile visibility",
  },
  { id: "gis/text", why: "text transforms and label decluttering" },
  { id: "terrain/quantized-mesh", why: "quantized-mesh terrain" },
  { id: "tiles-3d/buildings", why: "model transforms and visibility" },
];
const only = flag("only", null);
const selected = typeof only === "string" ? only.split(",") : [];
if (
  has("only") &&
  (!selected.length ||
    selected.some((id) => !ALL_EXAMPLES.some((e) => e.id === id)))
) {
  console.error(
    `Invalid --only example: ${JSON.stringify(only) ?? "(missing value)"}.\n` +
      `Choose one or comma-separated names: ${ALL_EXAMPLES.map((e) => e.id).join(", ")}`,
  );
  process.exit(1);
}
const EXAMPLES = has("only")
  ? ALL_EXAMPLES.filter((e) => selected.includes(e.id))
  : ALL_EXAMPLES.slice(0, 3);

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
  const r = spawnSync(program, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${program} exited ${r.status}`);
}

// ---------------------------------------------------------------------------
// Build both variants through the shipping pipeline. Only the SIMD target
// feature differs; everything else matches makes/rust.toml.
// ---------------------------------------------------------------------------
if (has("build")) {
  for (const [variant, feature] of [
    ["simd", "+simd128"],
    ["scalar", "-simd128"],
  ]) {
    console.log(`\n=== building ${variant} ===`);
    run(
      "cargo",
      [
        "build",
        "--release",
        "--target",
        "wasm32-unknown-unknown",
        "-Z",
        "build-std=std,panic_abort",
        ...MODULES.flatMap(([crate]) => ["-p", crate]),
      ],
      {
        RUSTC_BOOTSTRAP: "1",
        CARGO_PROFILE_RELEASE_OPT_LEVEL: "z",
        RUSTFLAGS: `--cfg getrandom_backend="wasm_js" -Ctarget-feature=${feature} -Zlocation-detail=none -Zunstable-options -Cpanic=immediate-abort`,
      },
    );
    for (const [crate] of MODULES) {
      const dir = resolve(out, variant, crate);
      mkdirSync(dir, { recursive: true });
      // Preserve named Rust output for SIMD attribution before stripping names.
      copyFileSync(
        resolve(root, `target/wasm32-unknown-unknown/release/${crate}.wasm`),
        resolve(out, variant, `${crate}.wasm`),
      );
      run("wasm-bindgen", [
        `target/wasm32-unknown-unknown/release/${crate}.wasm`,
        "--out-dir",
        dir,
        "--target",
        "web",
      ]);
      const wasm = resolve(dir, `${crate}_bg.wasm`);
      run("wasm-opt", [
        "-Oz",
        "--strip-debug",
        "--strip-producers",
        wasm,
        "-o",
        wasm,
      ]);
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
    if (!existsSync(wasm))
      throw new Error(`Missing ${wasm}. Run with --build first.`);
    // wasm-bindgen writes `<crate>.js` beside the binary; that is the package entry.
    variants[variant][pkg] = resolve(dir, `${crate}.js`);
  }
}
// Ask the artifact itself which target features it was built with, rather than
// trusting that the RUSTFLAGS above reached the binary now filed under this
// variant (a stale `target/example-bench` would otherwise time the same build
// twice and report a dead heat). LLVM records them in a `target_features`
// custom section that survives `wasm-opt` and wasm-bindgen, so no `wasm-dis`
// dependency is needed. Returns null when the section is absent.
function targetFeatures(file) {
  const bytes = readFileSync(file);
  let offset = 8; // magic + version
  const leb = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[offset++];
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return result >>> 0;
  };
  while (offset < bytes.length) {
    const id = bytes[offset++];
    const size = leb();
    const end = offset + size;
    if (id === 0) {
      const nameLength = leb();
      if (
        bytes.toString("utf8", offset, offset + nameLength) ===
        "target_features"
      ) {
        offset += nameLength;
        const count = leb();
        const features = [];
        for (let i = 0; i < count; i++) {
          const prefix = String.fromCharCode(bytes[offset++]); // + - =
          const length = leb();
          features.push(
            prefix + bytes.toString("utf8", offset, offset + length),
          );
          offset += length;
        }
        return features;
      }
    }
    offset = end;
  }
  return null;
}

for (const variant of ["simd", "scalar"]) {
  const wantSimd = variant === "simd";
  let total = 0;
  for (const [crate] of MODULES) {
    const file = resolve(out, variant, crate, `${crate}_bg.wasm`);
    const features = targetFeatures(file);
    if (features === null)
      throw new Error(
        `${file} has no target_features section; cannot verify the variant.`,
      );
    if (features.includes("+simd128") !== wantSimd)
      throw new Error(
        `${crate} under ${variant}/ ${wantSimd ? "lacks" : "has"} +simd128 ` +
          `(${features.join(" ")}). The artifacts in ${out} do not match the ` +
          `variant they are filed under — re-run with --build.`,
      );
    total += readFileSync(file).length;
  }
  console.log(
    `${variant}: ${MODULES.length} modules, ${(total / 1048576).toFixed(2)} MB raw, simd128=${wantSimd}`,
  );
}

if (has("build-only")) process.exit(0);

// ---------------------------------------------------------------------------
// Dev server. Aliases select matching WASM binaries and JS glue; everything else
// is the real example app, served as `cargo make web` would serve it.
// ---------------------------------------------------------------------------
let servedFromVariant = 0;
/** Requests served from each variant's directory, summed over the whole run. */
const servedTotals = { simd: 0, scalar: 0 };

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
      alias: Object.entries(variants[name]).map(([find, replacement]) => ({
        find,
        replacement,
      })),
    },
    server: {
      host: "127.0.0.1",
      port: PORT,
      strictPort: PORT !== 0,
      open: false,
      hmr: false,
    },
    plugins: [
      {
        name: "example-bench-frames",
        enforce: "pre",
        transform(code, id) {
          if (id.endsWith("navara_three/src/concurrency.ts")) {
            const anchor = "Math.max(navigator.hardwareConcurrency, 1)";
            if (!code.includes(anchor))
              throw new Error("Worker-count instrumentation anchor moved");
            return code.replace(anchor, String(WORKERS));
          }
          if (!id.endsWith("navara_three/src/index.ts")) return null;
          const animation = "this._renderFlag.animation = !!options.animation;";
          const begin = "      this._stats?.begin();";
          const end = "      this._stats?.end();";
          for (const anchor of [animation, begin, end]) {
            if (code.split(anchor).length !== 2)
              throw new Error("Frame instrumentation anchor moved");
          }
          return code
            .replace(animation, "this._renderFlag.animation = true;")
            .replace(
              begin,
              `
              const __benchStart = performance.now();
              ${begin}`,
            )
            .replace(
              end,
              `
              ${end}
              if (globalThis.__bench?.sampling) {
                const b = globalThis.__bench;
                const elapsed = performance.now() - __benchStart;
                b.cpuMs.push(elapsed);
                if (b.previousFrame !== null) b.intervalMs.push(time - b.previousFrame);
                b.previousFrame = time;
              }
            `,
            );
        },
      },
      {
        name: "example-bench-verify",
        configureServer(s) {
          s.middlewares.use((req, _res, next) => {
            if ((req.url ?? "").includes(`example-bench/${name}/`))
              servedFromVariant++;
            next();
          });
        },
      },
    ],
  });
  await server.listen();
  activePort = server.httpServer.address().port;
  return server;
}

// ---------------------------------------------------------------------------
// Instrumentation injected before any page script runs.
// ---------------------------------------------------------------------------
const instrument = () => {
  window.__bench = {
    tasks: 0,
    pending: 0,
    lastTaskAt: performance.now(),
    sampling: false,
    cpuMs: [],
    intervalMs: [],
    previousFrame: null,
  };
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.__pending = new Set();
      this.addEventListener("message", ({ data }) => {
        if (data?.isEvent || !this.__pending.delete(data?.id)) return;
        const b = window.__bench;
        b.pending--;
        b.tasks++;
        b.lastTaskAt = performance.now();
      });
    }
    postMessage(message, ...rest) {
      // Memory telemetry is periodic and must not prevent settling.
      const method = message?.method ?? message?.type;
      if (
        message?.id != null &&
        method &&
        !["getWasmMemoryUsage", "getMemoryStats"].includes(method) &&
        !this.__pending.has(message.id)
      ) {
        this.__pending.add(message.id);
        window.__bench.pending++;
        window.__bench.lastTaskAt = performance.now();
      }
      return super.postMessage(message, ...rest);
    }
    terminate() {
      window.__bench.pending -= this.__pending.size;
      this.__pending.clear();
      return super.terminate();
    }
  };
};

// ---------------------------------------------------------------------------
// Tile record/replay so every variant sees identical bytes.
// ---------------------------------------------------------------------------
const cachePath = (url) =>
  resolve(tileCache, createHash("sha1").update(url).digest("hex"));
let recorded = 0;
let replayed = 0;

async function installTileCache(page, errors) {
  await page.route("**/*", async (route) => {
    // A route can outlive its page: closing the context mid-flight disposes the
    // response and every call here throws. None of that is a measurement error,
    // so swallow it and let the request die quietly.
    try {
      const url = route.request().url();
      if (url.startsWith(`http://127.0.0.1:${activePort}`))
        return await route.continue();
      const file = cachePath(url);
      if (existsSync(file)) {
        replayed++;
        const meta = JSON.parse(readFileSync(`${file}.json`, "utf8"));
        if (meta.status < 200 || meta.status >= 300)
          throw new Error(`Cached HTTP ${meta.status}: ${url}`);
        return await route.fulfill({
          status: meta.status,
          headers: meta.headers,
          body: readFileSync(file),
        });
      }
      const response = await route.fetch();
      if (!response.ok()) throw new Error(`HTTP ${response.status()}: ${url}`);
      const body = await response.body();
      writeFileSync(file, body);
      writeFileSync(
        `${file}.json`,
        JSON.stringify({
          status: response.status(),
          headers: {
            "content-type":
              response.headers()["content-type"] ?? "application/octet-stream",
          },
        }),
      );
      recorded++;
      return await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body,
      });
    } catch (error) {
      if (!page.isClosed()) errors.push(String(error));
      try {
        await route.abort();
      } catch {
        /* page already gone */
      }
    }
  });
}

const browser = await chromium.launch({
  headless: !has("headed"),
  channel: "chrome",
});
const rows = [];
const failures = [];
console.log(
  "Before = SIMD OFF; after = SIMD ON. Timing the complete update + render callback.",
);
try {
  // Warm each variant and record external assets before measured rounds.
  for (let round = -1; round < ROUNDS; round++) {
    for (const name of round % 2 ? ["scalar", "simd"] : ["simd", "scalar"]) {
      servedFromVariant = 0;
      const server = await startServer(name);
      try {
        for (const example of EXAMPLES) {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: 1,
          });
          const errors = [];
          try {
            await context.addInitScript(instrument);
            const page = await context.newPage();
            page.on("pageerror", (e) => errors.push(e.message));
            page.on("console", (m) => {
              if (m.type() === "error") errors.push(m.text());
            });
            await installTileCache(page, errors);
            await page.goto(
              `http://127.0.0.1:${activePort}/demo/${example.id}.html`,
              { waitUntil: "load" },
            );
            await page.waitForFunction(
              (quiet) => {
                const b = window.__bench;
                return (
                  b &&
                  b.tasks > 0 &&
                  b.pending === 0 &&
                  performance.now() - b.lastTaskAt > quiet
                );
              },
              QUIET_MS,
              { timeout: MAX_MS },
            );
            // Additional warmup for shaders/JIT after the worker queue settles.
            await page.waitForTimeout(2000);
            await page.evaluate(() => {
              Object.assign(window.__bench, {
                sampling: true,
                cpuMs: [],
                intervalMs: [],
                previousFrame: null,
              });
            });
            await page.waitForTimeout(FRAME_WINDOW_MS);
            const state = await page.evaluate(() => {
              window.__bench.sampling = false;
              return window.__bench;
            });
            if (errors.length) throw new Error(errors.slice(0, 3).join("; "));
            if (state.cpuMs.length < 60 || state.intervalMs.length < 59)
              throw new Error("Too few frames");
            if (round === 0)
              await page.screenshot({
                path: resolve(
                  out,
                  `${example.id.replaceAll("/", "-")}-${name}.png`,
                ),
              });
            if (round >= 0)
              rows.push({
                example: example.id,
                variant: name,
                round,
                cpuMs: state.cpuMs,
                intervalMs: state.intervalMs,
                tasks: state.tasks,
              });
            console.log(
              `  ${example.id} | SIMD ${name === "simd" ? "ON " : "OFF"} | ${round < 0 ? "warmup" : `round ${round + 1}/${ROUNDS}`} | ` +
                `frame CPU ${mean(state.cpuMs).toFixed(3)} ms | frame interval ${mean(state.intervalMs).toFixed(3)} ms | ${state.cpuMs.length} frames`,
            );
          } catch (error) {
            failures.push({
              example: example.id,
              variant: name,
              round,
              error: String(error),
            });
            console.error(
              `  FAILED ${example.id} ${name} round ${round + 1}: ${String(error).split("\n")[0]}`,
            );
          } finally {
            await context.close();
          }
        }
      } finally {
        await server.close();
      }
      servedTotals[name] += servedFromVariant;
    }
  }
} finally {
  await browser.close();
}

const report = [];
for (const example of EXAMPLES) {
  const samples = (variant) =>
    rows
      .filter((r) => r.example === example.id && r.variant === variant)
      .sort((a, b) => a.round - b.round);
  const before = samples("scalar");
  const after = samples("simd");
  if (
    before.length !== ROUNDS ||
    after.length !== ROUNDS ||
    !servedTotals.scalar ||
    !servedTotals.simd
  )
    continue;
  report.push({
    example: example.id,
    why: example.why,
    cpu: compare(
      before.map((r) => mean(r.cpuMs)),
      after.map((r) => mean(r.cpuMs)),
    ),
    cpuP95: compare(
      before.map((r) => percentile(r.cpuMs, 95)),
      after.map((r) => percentile(r.cpuMs, 95)),
    ),
    interval: compare(
      before.map((r) => mean(r.intervalMs)),
      after.map((r) => mean(r.intervalMs)),
    ),
  });
}
console.log(
  "\nComplete frame CPU time: update + render submission (ms, lower is better).",
);
console.log(
  "Before = SIMD OFF; after = SIMD ON; positive improvement = faster.",
);
console.table(report.map((r) => comparisonRow(r.example, r.cpu)));
console.log(
  "\nFrame interval: includes GPU/scheduling/vsync waits; not isolated GPU execution time (ms).",
);
console.table(
  report.map((r) => ({
    example: r.example,
    "SIMD OFF ms": r.interval.beforeMs.toFixed(2),
    "SIMD ON ms": r.interval.afterMs.toFixed(2),
  })),
);
writeFileSync(
  resolve(out, "frames.json"),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      cpu: os.cpus()[0].model,
      browser: browser.version(),
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      artifactHashes: Object.fromEntries(
        ["scalar", "simd"].map((variant) => [
          variant,
          Object.fromEntries(
            MODULES.map(([crate]) => [
              crate,
              createHash("sha256")
                .update(
                  readFileSync(
                    resolve(out, variant, crate, `${crate}_bg.wasm`),
                  ),
                )
                .digest("hex"),
            ]),
          ),
        ]),
      ),
      viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
      headed: has("headed"),
      workerPoolSize: WORKERS,
      rounds: ROUNDS,
      frameWindowMs: FRAME_WINDOW_MS,
      servedTotals,
      recorded,
      replayed,
      report,
      failures,
      rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(`\nResults: ${out}/frames.json`);
if (report.length !== EXAMPLES.length) {
  console.error(
    "Incomplete measurements: failed examples were excluded; inspect failures in frames.json.",
  );
  process.exitCode = 1;
}
