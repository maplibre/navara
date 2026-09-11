// Native Rust timing plus emitted-code evidence. No WebAssembly runtime.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { compare, comparisonRow } from "./bench-stats.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "target/simd-native");
const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const rounds = Number(flag("rounds", 8));
if (!Number.isInteger(rounds) || rounds < 1)
  throw new Error("--rounds must be positive");
mkdirSync(out, { recursive: true });
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed:\n${result.stderr}`);
  return result;
}

const builds = [];
for (const opt of ["z", "3"]) {
  for (const vectorize of [false, true]) {
    const name = `${opt}-${vectorize ? "on" : "off"}`;
    const directory = resolve(out, name);
    mkdirSync(directory, { recursive: true });
    const flags = [
      "-Ctarget-cpu=native",
      "-Cdebuginfo=1",
      "-Cstrip=none",
      ...(!vectorize ? ["-Cno-vectorize-loops", "-Cno-vectorize-slp"] : []),
    ].join(" ");
    console.log(
      `Building native Rust: opt-level=${opt}, auto-vectorization=${vectorize}`,
    );
    const result = run(
      "cargo",
      [
        "rustc",
        "--locked",
        "--release",
        "-p",
        "navara_core",
        "--example",
        "simd_native",
        "--",
        "--emit=link,llvm-ir,asm",
        "-Cremark=loop-vectorize,slp-vectorizer",
      ],
      {
        CARGO_TARGET_DIR: resolve(out, "cargo"),
        CARGO_PROFILE_RELEASE_OPT_LEVEL: opt,
        RUSTFLAGS: flags,
      },
    );
    writeFileSync(resolve(directory, "compiler.log"), result.stderr);
    const artifacts = resolve(out, "cargo/release/examples");
    const executable = resolve(
      directory,
      `simd_native${process.platform === "win32" ? ".exe" : ""}`,
    );
    copyFileSync(
      resolve(
        artifacts,
        `simd_native${process.platform === "win32" ? ".exe" : ""}`,
      ),
      executable,
    );
    // Match the linked binary, including on cache hits. Picking the newest IR
    // could accidentally attribute a previous variant's code to this build.
    const binary = readFileSync(executable);
    const ir = readdirSync(artifacts)
      .filter((f) => f.endsWith(".ll") && f.startsWith("simd_native"))
      .find((f) => {
        const linked = resolve(
          artifacts,
          f.replace(/\.ll$/, process.platform === "win32" ? ".exe" : ""),
        );
        return existsSync(linked) && readFileSync(linked).equals(binary);
      });
    if (!ir) throw new Error("Compiler did not emit LLVM IR");
    copyFileSync(resolve(artifacts, ir), resolve(directory, "code.ll"));
    copyFileSync(
      resolve(artifacts, ir.replace(/\.ll$/, ".s")),
      resolve(directory, "code.s"),
    );
    const code = readFileSync(resolve(directory, "code.ll"), "utf8");
    const evidence = {};
    for (const kernel of [
      "planes",
      "culling",
      "transforms",
      "encoding",
      "geodetic",
    ]) {
      const body = code.match(
        new RegExp(`^define[^\\n]*@bench_${kernel}\\([^]*?^}`, "m"),
      )?.[0];
      if (!body) throw new Error(`Missing bench_${kernel} in LLVM IR`);
      const vectorMath = body
        .split("\n")
        .filter((line) =>
          /\b(?:fadd|fsub|fmul|fdiv|fcmp|fneg|fptosi|fptrunc|fpext)\b.*<\d+ x |@llvm\.[\w.]+\.v\d+f/.test(
            line,
          ),
        );
      evidence[kernel] = {
        vectorMathInstructions: vectorMath.length,
        instructions: vectorMath,
      };
    }
    writeFileSync(
      resolve(directory, "vectorization.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    builds.push({ name, opt, vectorize, executable, flags, evidence });
  }
}

// All compilation finishes before measurement. Alternate execution order.
const rows = [];
for (let round = 0; round < rounds; round++) {
  for (const opt of ["z", "3"]) {
    const pair = builds.filter((b) => b.opt === opt);
    if (round % 2) pair.reverse();
    for (const build of pair) {
      const samples = run(build.executable, ["200"])
        .stdout.trim()
        .split("\n")
        .map(JSON.parse);
      rows.push(
        ...samples.map((sample) => ({ ...sample, round, build: build.name })),
      );
    }
  }
  console.log(`Native round ${round + 1}/${rounds} complete`);
}
const report = [];
for (const opt of ["z", "3"]) {
  for (const kernel of [
    "planes",
    "culling",
    "transforms",
    "encoding",
    "geodetic",
  ]) {
    const samples = rows.filter(
      (r) => r.kernel === kernel && r.build.startsWith(`${opt}-`),
    );
    if (new Set(samples.map((r) => r.checksum)).size !== 1)
      throw new Error(`${kernel}: output mismatch`);
    const values = (state) =>
      samples.filter((r) => r.build === `${opt}-${state}`).map((r) => r.ms);
    const comparison = compare(values("off"), values("on"));
    report.push({
      opt,
      kernel,
      items: samples[0].items,
      ...comparison,
      vectorMathOff: builds.find((b) => b.name === `${opt}-off`).evidence[
        kernel
      ].vectorMathInstructions,
      vectorMathOn: builds.find((b) => b.name === `${opt}-on`).evidence[kernel]
        .vectorMathInstructions,
    });
  }
}
console.log(
  "\nNative Rust: ms per 16,384 items. Before = auto-vectorization OFF; after = ON.",
);
console.log(
  "Positive improvement means faster. This is native CPU SIMD, not wasm simd128.",
);
console.table(
  report.map((r) => ({
    ...comparisonRow(`${r.opt}: ${r.kernel}`, r, 4),
    "vector math off/on": `${r.vectorMathOff}/${r.vectorMathOn}`,
  })),
);
writeFileSync(
  resolve(out, "results.json"),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      cpu: os.cpus()[0].model,
      platform: `${os.platform()} ${os.arch()}`,
      rustc: run("rustc", ["-vV"]).stdout,
      rounds,
      builds,
      report,
      rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Results and compiler evidence: ${out}`);
