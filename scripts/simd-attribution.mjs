// Report where WebAssembly SIMD instructions actually landed in the built
// modules, attributed to the Rust crate that emitted them. See guide/SIMD.md.
//
// Enabling `simd128` is a whole-program flag, so "is SIMD on" is not the useful
// question; "which code got vectorized" is. This disassembles each module and
// counts v128 instructions per function, separating lane math (the arithmetic
// that can actually be faster) from `v128.load`/`store`/`const`, which are
// mostly vectorized `memcpy` of vertex, index, and struct data.
//
// Usage:
//   node scripts/simd-attribution.mjs [--dir <path>] [--top <n>]
//
// `--dir` defaults to the release output of `cargo make build-rust-all-wasm`.
// Read the pre-`wasm-bindgen` artifacts: they still carry the name section that
// makes attribution possible.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argument = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
};
const directory = resolve(
  root,
  argument("--dir", "target/wasm32-unknown-unknown/release"),
);
const top = Number(argument("--top", "12"));
const modules = [
  "navara_wasm",
  "navara_wasm_worker",
  "navara_wasm_font_worker",
  "navara_wasm_api",
];

const FUNCTION = /^\s*\(func \$([^\s)]+)/;
const LANE = /\b(?:i8x16|i16x8|i32x4|i64x2|f32x4|f64x2)\.([a-z0-9_]+)/g;
const V128 = /\bv128\.([a-z0-9_]+)/g;
// Vectorized data movement and lane broadcast: real instructions, but they
// indicate a wider `memcpy`, not arithmetic that SIMD made cheaper.
const MOVEMENT = new Set([
  "load",
  "store",
  "const",
  "load8_splat",
  "load16_splat",
  "load32_splat",
  "load64_splat",
  "load32_zero",
  "load64_zero",
]);

// Both rustc manglings prefix the symbol with the crate that defined the item.
// v0 spells it `...Cs<hash>_<len><crate>`; legacy spells it `_ZN<len><crate>`.
function crateOf(symbol) {
  const v0 = /Cs[0-9A-Za-z]+_(\d+)([A-Za-z_][A-Za-z0-9_]*)/.exec(symbol);
  if (v0) return v0[2].slice(0, Number(v0[1]));
  const legacy = /^_?(?:ZN)?(\d+)([A-Za-z_][A-Za-z0-9_]*)/.exec(symbol);
  return legacy ? legacy[2].slice(0, Number(legacy[1])) : "?";
}

async function analyze(path) {
  const child = spawn("wasm-dis", [path], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const functions = new Map();
  let current = null;
  for await (const line of createInterface({ input: child.stdout })) {
    const header = FUNCTION.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    if (!current || !/(?:x16|x8|x4|x2|v128)\./.test(line)) continue;
    let total = 0;
    let math = 0;
    for (const match of line.matchAll(LANE)) {
      void match;
      total += 1;
      math += 1;
    }
    for (const [, op] of line.matchAll(V128)) {
      total += 1;
      if (!MOVEMENT.has(op)) math += 1;
    }
    if (!total) continue;
    const entry = functions.get(current) ?? { total: 0, math: 0 };
    entry.total += total;
    entry.math += math;
    functions.set(current, entry);
  }
  const status = await new Promise((done) => child.on("close", done));
  if (status !== 0) throw new Error(`wasm-dis exited ${status} for ${path}`);
  return functions;
}

for (const module of modules) {
  const path = resolve(directory, `${module}.wasm`);
  if (!existsSync(path)) {
    console.log(`${module}: missing (${path})\n`);
    continue;
  }
  const functions = await analyze(path);
  let total = 0;
  let math = 0;
  const crates = new Map();
  for (const [symbol, counts] of functions) {
    total += counts.total;
    math += counts.math;
    const crate = crateOf(symbol);
    const entry = crates.get(crate) ?? { total: 0, math: 0, functions: 0 };
    entry.total += counts.total;
    entry.math += counts.math;
    entry.functions += 1;
    crates.set(crate, entry);
  }
  console.log(
    `${module}: ${total} v128 instructions — ${math} lane math, ` +
      `${total - math} load/store/const, across ${functions.size} functions`,
  );
  if (!total) {
    console.log("");
    continue;
  }
  console.table(
    [...crates]
      .sort((a, b) => b[1].math - a[1].math || b[1].total - a[1].total)
      .slice(0, top)
      .map(([crate, entry]) => ({
        crate,
        laneMath: entry.math,
        loadStoreConst: entry.total - entry.math,
        functions: entry.functions,
      })),
  );
  const hot = [...functions]
    .filter(([, counts]) => counts.math > 0)
    .sort((a, b) => b[1].math - a[1].math)
    .slice(0, top);
  if (hot.length) {
    console.log("Functions with the most lane math:");
    for (const [symbol, counts] of hot) {
      console.log(
        `  ${String(counts.math).padStart(5)}  ${symbol.slice(0, 130)}`,
      );
    }
  }
  console.log("");
}
