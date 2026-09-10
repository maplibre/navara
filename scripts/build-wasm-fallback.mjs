// Build the non-SIMD fallback `.wasm` for every module.
//
// The primary artifacts are built with `simd128` (see .cargo/config.toml). This
// script rebuilds the same crates without it and drops the result next to each
// primary as `<crate>_bg.nosimd.wasm`. At runtime the web packages probe for
// SIMD support and hand the fallback URL to `init()` when it is missing, so the
// browser floor stays where the rest of the WebAssembly features put it rather
// than being raised to Safari 16.4 (see guide/SIMD.md).
//
// Both builds go through wasm-bindgen, which generates the JS glue from the Rust
// API surface — not from codegen flags — so the two glues are byte-identical and
// only one is shipped. That invariant is asserted below: if it ever breaks, the
// fallback would be paired with the wrong bindings, so the build fails loudly
// instead of shipping something subtly broken.
//
// A separate --target-dir keeps the differing RUSTFLAGS from invalidating the
// primary build's fingerprints on every switch.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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

function run(program, args, env) {
  const result = spawnSync(program, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${program} exited ${result.status}`);
}

// Mirrors [tasks.build-rust-all-wasm] in makes/rust.toml, minus `+simd128`.
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
let total = 0;

for (const [crate, pkg] of MODULES) {
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
    const shipped = resolve(root, "web/wasm", pkg, `${crate}.js`);
    const fallback = resolve(staging, `${crate}.js`);
    if (!readFileSync(shipped).equals(readFileSync(fallback))) {
      throw new Error(
        `${crate}: wasm-bindgen glue differs between the SIMD and non-SIMD builds.\n` +
          `The fallback .wasm can no longer share ${pkg}/${crate}.js. Ship the ` +
          `fallback's glue too, or drop the fallback for this module.`,
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
    const dest = resolve(root, "web/wasm", pkg, `${crate}_bg.nosimd.wasm`);
    copyFileSync(staged, dest);
    total += size(dest);
    const primary = resolve(root, "web/wasm", pkg, `${crate}_bg.wasm`);
    console.log(
      `${pkg}/${crate}_bg.nosimd.wasm  ${size(dest).toLocaleString()} bytes ` +
        `(primary ${size(primary).toLocaleString()})`,
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
console.log(
  `\nfallback artifacts total ${total.toLocaleString()} bytes (served only to runtimes without SIMD)`,
);
