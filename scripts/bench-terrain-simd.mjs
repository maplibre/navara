// Build and measure the same Rust terrain code with SIMD and optimization varied
// independently. Requires the repository toolchain, wasm-opt, wasm-dis, and Node.
import { spawnSync } from "node:child_process";
import { deepStrictEqual } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
process.chdir(root);
const out = resolve("target/terrain-simd-bench");
mkdirSync(out, { recursive: true });

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${program} exited ${result.status} (signal ${result.signal})`,
    );
  return result.stdout;
}

// Axes are env-overridable so a focused comparison (e.g. no SIMD, wasm-opt -Oz
// vs -O4) can be timed inside one process with alternating order, which is more
// reliable than comparing two separate runs.
//   BENCH_SIMD=0        -> scalar only        (default "0,1")
//   BENCH_WASM_OPT=Oz,O4 -> both post-link levels (default "Oz")
const SIMD_AXIS = (process.env.BENCH_SIMD ?? "0,1")
  .split(",")
  .map((v) => v === "1");
const WASM_OPT_AXIS = (process.env.BENCH_WASM_OPT ?? "Oz").split(",");

const variants = [];
for (const opt of ["z", "3"]) {
  for (const simd of SIMD_AXIS) {
    for (const wasmOpt of WASM_OPT_AXIS) {
      // Default level keeps the historical variant names unchanged.
      const name =
        `${simd ? "simd" : "scalar"}-${opt}` +
        (wasmOpt === "Oz" ? "" : `-${wasmOpt}`);
      const directory = resolve(out, name);
      const path = resolve(directory, "terrain_simd_bench_bg.wasm");
      if (!process.argv.includes("--skip-build")) {
        command(
          "cargo",
          [
            "build",
            "--release",
            "--target",
            "wasm32-unknown-unknown",
            "-p",
            "navara_geometry",
            "--example",
            "terrain_simd_bench",
          ],
          {
            env: {
              ...process.env,
              CARGO_PROFILE_RELEASE_OPT_LEVEL: opt,
              RUSTFLAGS: `--cfg getrandom_backend="wasm_js" -Ctarget-feature=${simd ? "+" : "-"}simd128`,
            },
          },
        );
        command("wasm-bindgen", [
          "target/wasm32-unknown-unknown/release/examples/terrain_simd_bench.wasm",
          "--out-dir",
          directory,
          "--target",
          "nodejs",
        ]);
        // Post-link optimization. `-Oz` matches the shipping pipeline.
        command("wasm-opt", [
          `-${wasmOpt}`,
          "--strip-debug",
          "--strip-producers",
          path,
          "-o",
          path,
        ]);
      }
      const bytes = readFileSync(path);
      const wat = command("wasm-dis", [path], {
        encoding: "utf8",
        stdio: "pipe",
        maxBuffer: 32 * 1024 * 1024,
      });
      const simdInstructions = (
        wat.match(/\((?:v128|[if](?:8x16|16x8|32x4|64x2))\./g) ?? []
      ).length;
      if (!simd && simdInstructions !== 0)
        throw new Error("Scalar build contains SIMD");
      const exports = require(resolve(directory, "terrain_simd_bench.js"));
      variants.push({
        name,
        bytes: bytes.length,
        gzip: gzipSync(bytes, { level: 9 }).length,
        simdInstructions,
        exports,
      });
    }
  }
}

// Run only after all builds finish. Alternate variant order to reduce order bias.
const rows = [];
for (let kind = 0; kind < 3; kind++) {
  for (const check of ["verify_output", "verify_extra"]) {
    const expected = variants[0].exports[check](kind);
    for (const variant of variants.slice(1)) {
      deepStrictEqual(
        variant.exports[check](kind),
        expected,
        `${variant.name}: ${check} differs for decoder ${kind}`,
      );
    }
  }
}
// `decode`/`mesh`/`mesh_hoisted` vary with the DEM decoder; `polyline` and
// `inflate` do not, so they run once under the Mapbox label only.
const workloads = [
  { operation: "decode", iterations: 100, kinds: 3 },
  { operation: "mesh", iterations: 20, kinds: 3 },
  { operation: "mesh_hoisted", iterations: 20, kinds: 3 },
  { operation: "polyline", iterations: 20, kinds: 1 },
  { operation: "inflate", iterations: 10, kinds: 1 },
];
for (const workload of workloads) {
  const { operation, iterations } = workload;
  for (const [kind, decoder] of ["Mapbox", "Terrarium", "GSI"]
    .slice(0, workload.kinds)
    .entries()) {
    const samples = new Map(variants.map((v) => [v.name, []]));
    let expected;
    for (const variant of variants) {
      for (let warmup = 0; warmup < 10; warmup++) {
        const checksum = variant.exports[`bench_${operation}`](
          kind,
          iterations,
        );
        if (!Number.isFinite(checksum)) throw new Error("Non-finite output");
        expected ??= checksum;
        if (checksum !== expected)
          throw new Error(
            `Output mismatch: ${variant.name} ${operation} ${decoder}`,
          );
      }
    }
    for (let round = 0; round < 21; round++) {
      const order = round % 2 ? variants.toReversed() : variants;
      for (const variant of order) {
        const start = performance.now();
        const checksum = variant.exports[`bench_${operation}`](
          kind,
          iterations,
        );
        const elapsed = performance.now() - start;
        if (checksum !== expected)
          throw new Error("Output changed during measurement");
        samples.get(variant.name).push(elapsed / iterations);
      }
    }
    for (const variant of variants) {
      const times = samples.get(variant.name).sort((a, b) => a - b);
      rows.push({
        variant: variant.name,
        operation,
        decoder,
        medianMs: times[10],
        p10Ms: times[2],
        p90Ms: times[18],
        checksum: expected,
      });
    }
  }
}
const sizes = variants.map(({ exports, ...size }) => size);
const report = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  sizes,
  rows,
};
writeFileSync(
  resolve(out, "results.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.table(sizes);
console.table(rows.map(({ checksum, ...row }) => row));
console.log(`Results: ${out}/results.json`);
