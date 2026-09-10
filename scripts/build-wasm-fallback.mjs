// Build the non-SIMD fallback `.wasm` for every module.
//
// The primary artifacts are built with `simd128` (see .cargo/config.toml). This
// rebuilds the same crates without it and drops each result beside its primary
// as `<crate>_bg.nosimd.wasm`. `scripts/write-wasm-selector.mjs` then generates
// the `auto.js` that picks between them at runtime, so enabling SIMD does not
// raise the browser floor (see guide/SIMD.md).
//
//   node scripts/build-wasm-fallback.mjs
//   node scripts/build-wasm-fallback.mjs --only navara_wasm_worker
//
// Only publishable builds run this — `cargo make build-all`. Dev and debug
// builds generate a SIMD-only selector instead and skip it entirely. The flags
// below mirror [tasks.build-rust-all-wasm] in makes/rust.toml, minus `+simd128`,
// so the fallback is a like-for-like twin of the primary beside it.
//
// Both builds go through wasm-bindgen, which generates the JS glue from the
// Rust API surface — not from codegen flags — so the two glues are identical
// and only one is shipped. That invariant is asserted below: if it ever breaks,
// the fallback would be paired with the wrong bindings, so the build fails
// loudly instead of shipping something subtly broken.
//
// A separate --target-dir keeps the differing RUSTFLAGS from invalidating the
// primary build's fingerprints on every switch.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

/** crate -> the web/wasm directory its primary artifacts live in. */
const MODULES = [
  ["navara_wasm", "navara_engine"],
  ["navara_wasm_worker", "navara_engine_worker"],
  ["navara_wasm_font_worker", "navara_font_worker"],
  ["navara_wasm_api", "navara_engine_api"],
];

const TARGET_DIR = "target/wasm-nosimd";
const OUT = `${TARGET_DIR}/wasm32-unknown-unknown/release`;

const onlyArg = process.argv.indexOf("--only");
/** Restrict to a comma-separated list of crates, e.g. --only navara_wasm_worker. */
const ONLY =
  onlyArg === -1 ? null : new Set(process.argv[onlyArg + 1].split(","));

function run(program, args, env) {
  const result = spawnSync(program, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${program} exited ${result.status}`);
}

run(
  "cargo",
  [
    "build",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--target-dir",
    TARGET_DIR,
    "-Z",
    "build-std=std,panic_abort",
    ...MODULES.flatMap(([crate]) => ["-p", crate]),
  ],
  {
    RUSTC_BOOTSTRAP: "1",
    RUSTFLAGS:
      '--cfg getrandom_backend="wasm_js" -Zlocation-detail=none -Zunstable-options -Cpanic=immediate-abort',
  },
);

const hasWasmOpt =
  spawnSync("wasm-opt", ["--version"], { stdio: "ignore" }).status === 0;
if (!hasWasmOpt) console.warn("wasm-opt not found, skipping optimization");

const size = (p) => statSync(p).size;

// Cargo already compiles incrementally, but wasm-bindgen and wasm-opt do not:
// without this they would reprocess every module on every build, which is the
// slow part. Skip a module when neither its freshly built `.wasm` nor the glue
// it must stay compatible with has changed since the last successful run.
const STAMPS = resolve(root, TARGET_DIR, ".fallback-stamps.json");
let stamps = {};
try {
  stamps = JSON.parse(readFileSync(STAMPS, "utf8"));
} catch {
  // No stamp file yet, or it is unreadable: treat every module as stale.
}
// The two inputs need different treatment. Cargo rewrites its output only when
// the content changed, so size+mtime is both cheap and accurate there — and the
// binaries run to several MB, needlessly slow to hash on every build.
// wasm-bindgen, by contrast, rewrites all four glue files on every primary
// build even when nothing changed, so mtime there would never match and the
// skip would never fire; hash its (~600 KB) output instead.
const fingerprint = (wasmPath, gluePath) => {
  const { size: bytes, mtimeMs } = statSync(wasmPath);
  const glue = createHash("sha1").update(readFileSync(gluePath)).digest("hex");
  return `${bytes}:${Math.round(mtimeMs)}|${glue}`;
};

let total = 0;
let built = 0;
let skipped = 0;

for (const [crate, pkg] of MODULES) {
  if (ONLY && !ONLY.has(crate)) continue;

  const shipped = resolve(root, "web/wasm", pkg, `${crate}.js`);
  const dest = resolve(root, "web/wasm", pkg, `${crate}_bg.nosimd.wasm`);
  const key = crate;
  const stamp = fingerprint(`${OUT}/${crate}.wasm`, shipped);
  if (stamps[key] === stamp && existsSync(dest)) {
    skipped++;
    total += size(dest);
    console.log(`${pkg}/${crate}_bg.nosimd.wasm  up to date`);
    continue;
  }

  const staging = mkdtempSync(resolve(tmpdir(), `navara-nosimd-${crate}-`));
  try {
    run("wasm-bindgen", [
      `${OUT}/${crate}.wasm`,
      "--out-dir",
      staging,
      "--target",
      "web",
    ]);

    // The shipped glue must work for both binaries; see the note above.
    const fallback = resolve(staging, `${crate}.js`);
    if (!readFileSync(shipped).equals(readFileSync(fallback))) {
      throw new Error(
        `${crate}: wasm-bindgen glue differs between the SIMD and non-SIMD builds.\n` +
          `Most often ${pkg}/${crate}.js is not from the matching release build — a ` +
          `stray 'cargo make web' watch loop overwrites it with a debug build. If it ` +
          `is, the Rust API surface has diverged: ship the fallback's glue too, or ` +
          `drop the fallback for this module.`,
      );
    }

    const staged = resolve(staging, `${crate}_bg.wasm`);
    if (hasWasmOpt) {
      run("wasm-opt", [
        "-Oz",
        "--strip-debug",
        "--strip-producers",
        staged,
        "-o",
        staged,
      ]);
    }
    copyFileSync(staged, dest);
    built++;
    total += size(dest);
    stamps[key] = fingerprint(`${OUT}/${crate}.wasm`, shipped);
    const primary = resolve(root, "web/wasm", pkg, `${crate}_bg.wasm`);
    console.log(
      `${pkg}/${crate}_bg.nosimd.wasm  ${size(dest).toLocaleString()} bytes ` +
        `(primary ${size(primary).toLocaleString()})`,
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
writeFileSync(STAMPS, JSON.stringify(stamps, null, 2) + "\n");
console.log(
  `\n${built} rebuilt, ${skipped} up to date — ` +
    `${total.toLocaleString()} bytes of fallback artifacts ` +
    `(served only to runtimes without SIMD)`,
);
