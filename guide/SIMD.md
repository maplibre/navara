# WebAssembly SIMD

Navara enables `simd128` for its primary WASM artifacts **and ships a non-SIMD
build of every module alongside them**, selected at runtime. Enabling SIMD
therefore costs nothing in browser support.

Be clear-eyed about what SIMD buys here: measured three ways, it produced **no
detectable speedup in any real example page**. The reason to keep it on is the
~2% smaller primary artifacts and the headroom for future SIMD-aware
dependencies — not throughput.

| Method                                      | Result                                           |
| ------------------------------------------- | ------------------------------------------------ |
| Static attribution (`simd-attribution.mjs`) | 3 lane-math ops in Navara's own code, out of 750 |
| Node microbenchmarks                        | ±1% except a synthetic decode loop               |
| Real example pages in Chrome, 8 rounds      | every worker task's range overlaps               |

The cause is structural: Navara's geometry is `f64` transcendental math, which
WebAssembly SIMD cannot vectorize at all, and `glam`'s hand-written SIMD backend
is `f32`-only so `bevy_math` never reaches it.

## How the dual build works

Only **publishable** builds carry the fallback. `cargo make build-all` runs the
normal SIMD build, then `scripts/build-wasm-fallback.mjs` rebuilds the same
crates without `simd128` into a separate `--target-dir` and drops each result
beside its primary:

```
web/wasm/navara_engine/navara_wasm_bg.wasm          # simd128
web/wasm/navara_engine/navara_wasm_bg.nosimd.wasm   # fallback
web/wasm/navara_engine/auto.js                      # generated selector
```

| Build                                | Fallback built | Selector generated    |
| ------------------------------------ | -------------- | --------------------- |
| `build-all` (publish, deploy)        | **yes**        | probes, can fall back |
| `build-debug-all` (`cargo make web`) | no             | SIMD only             |
| `build-dev-all`                      | no             | SIMD only             |

Dev builds skip the second cargo build entirely — a no-op `build-debug-all` runs
in ~6s — and delete any fallback left behind by an earlier `build-all`, so the
package never contains a binary nothing references.

**Which browser a build must support is not knowable at build time.** One
deployed bundle serves Safari 15 and Safari 17 at once, so a publishable build
has to contain both binaries and choose per visitor. What _is_ knowable is what
a build is _for_: a dev server serves one known browser, so it needs only the
SIMD build.

### Why the selector is generated

`scripts/write-wasm-selector.mjs` writes an `auto.js` into each package. That
indirection is what makes the table above possible.

Any _static_ reference to the fallback — `import ... ?url`, or a `new URL()` a
bundler can analyse — forces the file to exist in **every** build, because the
bundler resolves it at transform time regardless of what the running browser
supports. Generating the module lets the SIMD-only variant simply not mention
the file:

```js
// build-all: probes, falls back
export default function initAuto(moduleOrPath) {
  if (moduleOrPath !== undefined) return init(moduleOrPath);
  return init(
    hasSimd()
      ? undefined
      : { module_or_path: new URL("./navara_wasm_bg.nosimd.wasm", import.meta.url) },
  );
}

// dev build: nothing to select between, nothing to resolve
export { default } from "./navara_wasm.js";
```

The probe is inlined rather than imported so the published packages stay
dependency-free, and it lives inside the package so the URL resolves against
the binaries beside it.

**One JS glue serves both binaries.** `wasm-bindgen` generates its bindings from
the Rust API surface, not from codegen flags, so the two glues are byte-identical.
The fallback script asserts that on every build and fails loudly otherwise —
pairing a fallback with mismatched bindings would be a miserable bug to chase.
The most common trigger is a mode mismatch: a stray `cargo make web` watch loop
overwriting `web/wasm/` with a debug build while a release fallback is being
built.

### Call sites

Consumers just call `init()`; the selector does the rest.

| Context     | File                                      | Imports from                         |
| ----------- | ----------------------------------------- | ------------------------------------ |
| Main thread | `web/navara_three/src/index.ts`           | `@navaramap/engine/auto`             |
| Main thread | `web/navara_three_api/src/index.ts`       | `@navaramap/engine-api/auto`         |
| Main thread | `web/navara_font/src/cssFontFamily.ts`    | `@navaramap/engine-api/auto`         |
| Tile worker | `web/navara_worker/src/tasks/waitWasm.ts` | `@navaramap/engine-worker/auto`      |
| Font worker | `web/navara_font/src/fontWorker.ts`       | `@navaramap/engine-font-worker/auto` |

**Each worker probes for itself.** A worker loads its own `.wasm`, and the main
thread's result does not travel with it. Missing a worker is the easy mistake:
the page would work while the worker fails to instantiate, and a worker's
failure does not reject `view.init()`.

### Incremental rebuilds

`wasm-bindgen` and `wasm-opt` do not rebuild incrementally the way cargo does,
so the fallback script stamps what each artifact was built from and skips
modules that cannot have changed. `--only <crate,...>` narrows it further.

| Situation                             | Result               |
| ------------------------------------- | -------------------- |
| Nothing changed                       | 0 rebuilt — **0.3s** |
| One crate touched, used by one module | 1 rebuilt, 3 skipped |
| One crate touched, shared by all      | 4 rebuilt (~44s)     |

The two inputs are fingerprinted differently, and the difference matters:
cargo's output by size and mtime (it only rewrites on real change, and
dev-profile binaries run to hundreds of MB — too big to hash every build), the
glue by content hash (`bindgen-all` rewrites all four glue files every build,
so mtime there would never match and the skip would never fire).

### Verifying it

```sh
# primary has vector instructions, fallback has none
for f in web/wasm/navara_engine/navara_wasm_bg.wasm \
         web/wasm/navara_engine/navara_wasm_bg.nosimd.wasm; do
  echo "$f $(wasm-dis "$f" | grep -cE '\b(i8x16|i16x8|i32x4|i64x2|f32x4|f64x2|v128)\.')"
done
```

To exercise the fallback path in a browser, note that no Chrome or V8 flag
disables SIMD any more — it is unconditionally shipped. Force it at the module
level instead. The probe lives in the generated selectors — one `auto.js` per
package under `web/wasm/` — so a Vite `transform` that rewrites its
`WebAssembly.validate(SIMD_PROBE)` call to `false` reaches every module,
including the worker bundles, which a Playwright `addInitScript` does not:

```ts
{
  name: "force-nosimd",
  transform(code, id) {
    if (!id.endsWith("/auto.js")) return;
    return code.replace("WebAssembly.validate(SIMD_PROBE)", "false");
  },
}
```

Build with `cargo make build-all` first. It is the only variant whose selectors
contain the probe at all: `build-dev-all` and `build-debug-all` generate the
SIMD-only selector, which re-exports `init` and has no fallback binary to
reach for.

Verified on 2026-09-10, `terrain/raster` in Chrome 152:

| Mode           | `.wasm` fetched                                                                | Result              |
| -------------- | ------------------------------------------------------------------------------ | ------------------- |
| Default        | `navara_wasm_bg.wasm`, `navara_wasm_api_bg.wasm`, `navara_wasm_worker_bg.wasm` | 394 tasks, 0 errors |
| Forced no-SIMD | `..._bg.nosimd.wasm` for all three, **including the worker**                   | 392 tasks, 0 errors |

Both render identically.

## What actually sets Navara's browser floor

**Turning SIMD off does not make Navara run on old browsers.** SIMD was never the
only post-MVP WebAssembly feature in the binaries. `rustc` enables six of them by
default for `wasm32-unknown-unknown`, and they are still there:

```sh
rustc --print cfg --target wasm32-unknown-unknown | grep target_feature
# bulk-memory  multivalue  mutable-globals
# nontrapping-fptoint  reference-types  sign-ext
```

Confirm what a built module actually requires with
`wasm-opt --print-features <module>.wasm -o /dev/null`.

Approximate first versions (verify against caniuse before relying on these):

| Feature                       | Chrome | Firefox |   Safari |
| ----------------------------- | -----: | ------: | -------: |
| `sign-ext`, `mutable-globals` |     74 |      61 |     13.0 |
| `multivalue`                  |     85 |      78 |     13.1 |
| `bulk-memory`                 |     75 |      79 | **15.0** |
| `nontrapping-fptoint`         |     75 |      64 | **15.0** |
| `reference-types`             | **96** |      79 | **15.0** |
| `simd128` _(primary only)_    |     91 |      89 |   _16.4_ |

Because the fallback is shipped and chosen at runtime, `simd128` does **not** set
the floor. What remains does:

| Path                           | Chrome | Firefox |   Safari |
| ------------------------------ | -----: | ------: | -------: |
| SIMD primary                   |     96 |      89 |     16.4 |
| **Fallback (effective floor)** | **96** |  **79** | **15.0** |

A Safari 15 user loads the fallback and Navara works; a Safari 16.4 user gets the
SIMD build. Without the fallback the floor would be 16.4. Chrome does not move
either way — `reference-types` binds it at 96 regardless.

Going below Safari 15 would mean disabling `reference-types` and `bulk-memory`
too (`-Ctarget-feature=-reference-types,-bulk-memory,...`). That is a much larger
change: `wasm-bindgen` output depends on reference types, and dropping bulk
memory costs size and speed. It has not been attempted.

### What happens on a runtime below the floor

The module fails to **compile**, not to run. `WebAssembly.instantiate` rejects
with a `CompileError` as soon as it validates an unsupported opcode, so the
failure is deterministic and happens at startup — there is no partially working
engine and no slow path. It surfaces in two places:

- **Main thread** — `await Promise.all([initCore(), initNavaraApi()])` in
  `ThreeView.init()` ([web/navara_three/src/index.ts](../web/navara_three/src/index.ts))
  rejects, so `await view.init()` rejects.
- **Workers** — the tile-worker pool and font worker load their own `.wasm`.
  Those failures happen inside the worker, so they do not reject `init()` and are
  easier to miss.

### Detecting support before initializing

Validate a tiny module that uses the feature. Validation is cheap, synchronous,
and touches no network. This probe covers the current floor (`reference-types`
via an `externref` parameter); swap in the `simd128` bytes if SIMD is ever
re-enabled:

```ts
/** `(func (param externref))` — rejected by runtimes without reference types. */
export const hasWasmReferenceTypes = (): boolean =>
  WebAssembly.validate(
    new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
      0x01, 0x6f, 0x00, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x04, 0x01, 0x02, 0x00,
      0x0b,
    ]),
  );

/** `i8x16.splat` + `i8x16.popcnt` — only needed if `simd128` is re-enabled. */
export const hasWasmSimd = (): boolean =>
  WebAssembly.validate(
    new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
      0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00,
      0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
    ]),
  );
```

Feature-detect rather than sniffing the user agent, and guard before `init()` so
the user sees a real message instead of a `CompileError`:

```ts
if (!hasWasmReferenceTypes()) {
  showUnsupportedBrowserNotice();
} else {
  await view.init();
}
```

This is what the dual build above already does for `simd128`. The same trick
could in principle cover `reference-types`, but that is a far larger change:
`wasm-bindgen`'s output depends on reference types, and dropping bulk memory
costs size and speed. It has not been attempted.

## Where SIMD instructions actually land

"Is SIMD enabled" is not the useful question — it is a whole-program flag. The
useful question is which code the compiler vectorized. Run:

```sh
cargo make build-rust-all-wasm       # or any build that leaves the name section
node scripts/simd-attribution.mjs
```

The script disassembles each module and counts `v128` instructions per function,
attributing them to the crate that emitted them. It separates **lane math** (the
arithmetic SIMD can actually make faster) from `v128.load`/`store`/`const`, which
are overwhelmingly just a wider `memcpy` of vertex, index, and struct data.

Measured on 2026-09-09 against the shipping release configuration
(`opt-level = "z"`, `build-std`, `panic=immediate-abort`):

| Module          | `v128` instructions<br>(total) | of which<br>lane math | of which<br>load/store/const |
| --------------- | -----------------------------: | --------------------: | ---------------------------: |
| Main engine     |                         21,676 |                   750 |                       20,926 |
| Geometry worker |                          1,793 |                   108 |                        1,685 |
| Font worker     |                         11,181 |                 3,224 |                        7,957 |
| API             |                          1,598 |                   114 |                        1,484 |

The equivalent scalar builds contain zero `v128` instructions, which is the
control for these counts.

Two things stand out:

- **93-97% of the vector instructions in the engine, worker, and API modules are
  data movement, not math.** That is a real but modest win — wider copies of
  vertex and index buffers — and it is most of what `simd128` buys those modules.
- **Almost all the genuine lane math is in dependencies, not in Navara.** At
  `opt-level = "z"` the geometry worker's 108 lane-math ops break down as
  `serde_json`'s string scanner (56), `simd_adler32` (46), `tracing_core` (2),
  `core`'s inlined `memchr` (1) — and 3 from Navara itself, all in
  `navara_core`'s `Plane::from_point_normal`. Nothing at all in the terrain,
  polyline, or polygon builders. The font worker is the exception: 3,224
  lane-math ops, of which 3,166 are `tiny-skia`'s hand-written `simd128` raster
  pipeline — which Navara uses only for the **COLRv1 color-glyph path**
  (`color_raster.rs`), not for the common MSDF text path.

At `opt-level = 3` the picture improves roughly tenfold — the geometry worker
goes from 108 to 1,116 lane-math ops, and Navara's own code finally appears:
`navara_geometry` contributes 100 (mostly `create_polyline_geometry`, 61) and
`navara_tile_component`'s `TileBoundingRegion::from_extent_f64` another 49,
alongside `miniz_oxide`'s inflate loop (75) and `serde_json` (178). Reproduce
with `--dir` pointing at an `opt-level = 3` build.

**LLVM's vectorizers are effectively off at `z`.** Any plan that depends on
auto-vectorization also depends on changing the optimization level — and, as the
timings below show, even where the vectorizer fires the wall-clock effect is
mostly absent.

### Why `bevy_math` / `glam` contributes nothing

`glam` (via `bevy_math`) does ship hand-written WebAssembly SIMD, and enabling
`simd128` already switches it on — `glam/src/f32.rs` selects the backend with
`#[cfg(target_feature = "simd128")] mod wasm;`. So the question is reasonable.

It contributes nothing here for one reason: **that backend exists only for the
`f32` types.** `glam/src/f32/` carries `wasm/`, `sse2/`, `neon/`, `coresimd/`,
and `scalar/` backends covering `Vec3A`, `Vec4`, `Mat2`, `Mat3A`, `Mat4`, and
`Quat`. `glam/src/f64/` has no backend directory at all — `dvec3.rs`,
`dvec4.rs`, `dmat4.rs`, and `dquat.rs` are plain scalar structs.

And [navara_math](../crates/navara_math/src/vertex.rs) aliases every public type
to the `f64` variants:

```rust
pub type Vec3 = RawDVec3; // glam::DVec3
pub type Mat4 = RawDMat4; // glam::DMat4
pub type Quat = RawDQuat; // glam::DQuat
```

The built engine confirms it: every one of the ~205 `glam` symbols in
`navara_wasm.wasm` is under `glam::f64::`. glam's SIMD backend is compiled in and
never called, because no `f32` glam type is ever instantiated.

This is not an oversight to fix. ECEF coordinates are on the order of 6.4e6 m,
where `f32`'s 24-bit mantissa gives roughly half-metre resolution — visible
jitter. `f64` is the right choice for globe coordinates, and the `f32` vertex
buffers are only produced after RTC translation has made the values small.

Two consequences worth remembering:

- Switching `navara_math` to `f32` glam types to unlock the SIMD backend would
  trade correctness for a speedup that the profile does not show a need for —
  glam appears nowhere in the lane-math attribution above.
- glam's `core-simd` feature does not help either; it sits in the same `f32`-only
  cfg chain. A hypothetical `f64` backend would give 2 lanes per `v128` at best,
  which is why upstream has not written one.

### Why terrain does not vectorize

`tile_triangles` ([crates/navara_geometry/src/tile.rs](../crates/navara_geometry/src/tile.rs))
costs, per vertex: `mercator_y_to_lat` (`exp` + `atan`), then `lle_to_xyz`'s
`sin`/`cos` of latitude and longitude plus a `sqrt`. That is roughly six `f64`
transcendental calls per vertex, or ~25,000 per 64-segment tile.

WebAssembly SIMD has no vector transcendentals — there is no `f64x2.sin` and no
vector libm for wasm32 — so LLVM cannot vectorize these loops at any optimization
level. Three further properties compound this: `FloatType` is `f64`, so a `v128`
holds only two lanes; the height callback is an opaque `&mut FnMut` that pushes
to a growing `Vec`; and DEM sampling is strided (`x * (terrain_w - 1) / segments`),
a gather rather than a contiguous read. Terrain is close to a worst case for
`simd128`, and the measurements below confirm it.

## Benchmark (historical)

> The harness behind this section — `scripts/bench-terrain-simd.mjs` and the
> `terrain_simd_bench` example crate — has been removed. It measured
> `tile_triangles`, which production only reaches as a flat-tile fallback; the
> real raster-DEM path is Martini. The numbers are kept because they are the
> evidence for the conclusions, but treat them as a record, not as something to
> re-run. `scripts/bench-examples.mjs` measures the real paths instead.

It compiled a synthetic terrain benchmark four ways — SIMD off/on, crossed with
`opt-level` `z`/`3` — running `wasm-bindgen` and `wasm-opt -Oz` over each.
Unlike the shipping release task it used the normal precompiled standard
library, so its binary sizes were benchmark sizes, not engine download sizes.

Workloads, all on deterministic synthetic input:

- **decode** — a contiguous loop over all 65,536 pixels of a 256x256 RGBA DEM.
  This is the vectorization-friendly shape, and deliberately _not_ what
  production does; it bounds the best case rather than predicting it.
- **mesh** — the production `tile_triangles_with_terrain` at 64 segments, WGS84,
  Mercator row spacing, RTC coordinates. Includes allocation; excludes tile
  fetching, worker messages, GPU upload, and rendering.
- **mesh_hoisted** — a prototype that computes identical output to `mesh` but
  evaluates `mercator_y_to_lat` and the `sin`/`cos` pairs once per row and once
  per column instead of once per vertex. It builds every output the production
  path builds (vertices, UVs, indices, heights, min/max), and its results are
  compared bit-for-bit against the production path before timing.
- **polyline** — `create_polyline_geometry` over a 2,048-point line with RTE.
- **inflate** — gzip decompression of a 1 MiB tile-shaped payload through
  `flate2`/`miniz_oxide`, the PMTiles decode path.

Before timing, complete outputs are compared exactly across all four variants,
and the hoisted prototype is compared against the production path. Each case
warms up ten times and collects 21 samples with alternating variant order.
`wasm-dis` counts vector instructions per artifact and asserts the scalar
variants contain none.

> A trap worth knowing: the hoisted prototype originally built its lat/lng tables
> from literals, so LLVM constant-folded the entire table at compile time and the
> transcendentals never ran. The tell was a one-ULP mismatch against production —
> compile-time folding uses the _host_ libm, the runtime path uses the wasm one.
> The inputs are now wrapped in `black_box`. Any benchmark added here needs the
> same care, which is what the output comparison is for.

### Results

**The four builds compared.** Every table below uses these short names:

| Short name | `rustc` opt-level | `simd128` | Notes          |
| ---------- | ----------------- | --------- | -------------- |
| `scalar-z` | `"z"` (size)      | off       |                |
| `simd-z`   | `"z"` (size)      | **on**    | **what ships** |
| `scalar-3` | `3` (speed)       | off       |                |
| `simd-3`   | `3` (speed)       | **on**    |                |

Node 25.2.1, Apple M4 Pro (macOS ARM64), 2026-09-09.

#### How long each workload took

**Milliseconds per iteration (median). Lower is better.**

| Workload               | `scalar-z` | `simd-z` | `scalar-3` | `simd-3` |
| ---------------------- | ---------: | -------: | ---------: | -------: |
| decode/Mapbox          |     0.0790 |   0.0790 |     0.0768 |   0.0695 |
| decode/Terrarium       |     0.0781 |   0.0783 |     0.0764 |   0.0695 |
| decode/GSI             |     0.1859 |   0.2327 |     0.2410 |   0.0706 |
| mesh/Mapbox            |     0.3068 |   0.3074 |     0.1676 |   0.1672 |
| mesh/Terrarium         |     0.3038 |   0.3003 |     0.1673 |   0.1673 |
| mesh/GSI               |     0.3055 |   0.3036 |     0.1642 |   0.1654 |
| mesh_hoisted/Mapbox    |     0.0713 |   0.0710 |     0.0555 |   0.0557 |
| mesh_hoisted/Terrarium |     0.0714 |   0.0714 |     0.0562 |   0.0560 |
| mesh_hoisted/GSI       |     0.0748 |   0.0751 |     0.0573 |   0.0568 |
| polyline               |     1.9711 |   1.9773 |     1.3868 |   1.4018 |
| inflate                |     3.7592 |   3.7309 |     3.4310 |   3.4173 |

#### What each change bought

**Percent change in run time. Negative = faster = good.** Anything within about
±2% is run-to-run noise, not a result.

| Workload               | Turning SIMD on<br>(at opt-level `z`) | Turning SIMD on<br>(at opt-level `3`) | Going `z`→`3`<br>(SIMD off) |
| ---------------------- | ------------------------------------: | ------------------------------------: | --------------------------: |
| decode/Mapbox          |                                 -0.1% |                             **-9.6%** |                       -2.8% |
| decode/Terrarium       |                                 +0.3% |                             **-8.9%** |                       -2.2% |
| decode/GSI             |                                +25.2% |                            **-70.7%** |                      +29.7% |
| mesh/Mapbox            |                                 +0.2% |                                 -0.3% |                  **-45.4%** |
| mesh/Terrarium         |                                 -1.2% |                                  0.0% |                  **-44.9%** |
| mesh/GSI               |                                 -0.6% |                                 +0.7% |                  **-46.3%** |
| mesh_hoisted/Mapbox    |                                 -0.4% |                                 +0.3% |                      -22.0% |
| mesh_hoisted/Terrarium |                                  0.0% |                                 -0.3% |                      -21.3% |
| mesh_hoisted/GSI       |                                 +0.4% |                                 -0.8% |                      -23.4% |
| polyline               |                                 +0.3% |                                 +1.1% |                  **-29.6%** |
| inflate                |                                 -0.8% |                                 -0.4% |                       -8.7% |

The two SIMD columns are the answer to "is SIMD worth it": everything in them is
noise except the `decode` row, and `decode` is not a loop production runs.
The third column is the optimization level, and it is where the real movement is.

Reading of these numbers:

- **SIMD does nothing measurable for real terrain mesh construction, polyline
  construction, or inflate**, at either optimization level.
- **SIMD helps only the contiguous decode loop, and only at `opt-level = 3`**
  (~-9%). The -71% on GSI at `3` is large and reproducible across runs, but it is
  specific: the GSI decoder branches per pixel, and on synthetic random RGB that
  branch is unpredictable, so vectorizing removes a mispredict rather than adding
  throughput. Real GSI tiles are spatially coherent — do not carry this ratio into
  production. The GSI `decode` scalar timings at `z` are themselves unstable,
  swinging from -17% to +25% between runs; treat that cell as noise, not signal.
  Note too that production never runs this loop: it samples 4,225 of the 65,536
  pixels, strided, inside the `mesh` timing.
- **`opt-level = 3` is the larger lever**, worth ~1.85x on mesh construction and
  ~1.4x on polylines, with SIMD contributing nothing on top.
- **Hoisting beats both.** At the shipped `z`, `mesh_hoisted` runs 4.1-4.3x faster
  than `mesh` for bit-identical output; at `3` it is still 2.9-3.0x. The hoisted
  version at `z` (0.071 ms) is ~2.4x faster than the production version at `3`
  (0.168 ms) — the source-level fix is worth more than the compiler flag, and
  costs no binary size.

These are Node/V8 CPU measurements, not browser frame-rate or tile-visibility
measurements. Repeat representative scenes in supported browsers before making
user-facing performance claims or changing the release optimization level.

## Real example pages in a browser

Everything above is a microbenchmark. `scripts/bench-examples.mjs` is the
opposite: it loads the shipped demo pages in headless Chrome, swaps only the four
`.wasm` artifacts between runs, and times each worker task the engine dispatches.

```sh
node scripts/bench-examples.mjs --build            # build both variants first
node scripts/bench-examples.mjs --rounds 8 --only basemap/vector-map
node scripts/bench-examples.mjs --headed           # watch it run
```

Tile responses are recorded to `target/example-bench/tiles` on the first run and
replayed from disk afterwards, so both variants see byte-identical input. The
harness aborts if the variant alias never applied — without that guard both runs
would silently load whatever is in `web/wasm/` and the comparison would be
meaningless.

Chrome 152, 1280x800, 8 rounds per variant, alternating order. CPU ms per page
load, summed per worker method:

**`terrain/raster`** — the real Martini raster-DEM path:

| Worker task            | scalar | simd |  delta | ranges  |
| ---------------------- | -----: | ---: | -----: | ------- |
| `constructTerrainMesh` |   1889 | 1872 |  -0.9% | overlap |
| `getImageDataFromBlob` |    484 |  486 |  +0.4% | overlap |
| `warmUp`               |    359 |  300 | -16.4% | overlap |
| `upsampleTerrainMesh`  |     85 |   79 |  -7.1% | overlap |

**`basemap/vector-map`** — MVT parse plus polygon/polyline batching:

| Worker task                       | scalar | simd | delta | ranges  |
| --------------------------------- | -----: | ---: | ----: | ------- |
| `constructPolygonBatchedFeature`  |    996 | 1030 | +3.4% | overlap |
| `parseMvtTile`                    |    917 |  909 | -0.9% | overlap |
| `constructPolylineBatchedFeature` |    349 |  357 | +2.3% | overlap |

**Every row's per-round range overlaps.** There is no effect to report.

> Two traps this exposed, worth repeating for anyone extending the harness:
>
> - **Three rounds is not enough.** At 3 rounds `parseMvtTile` looked like a
>   consistent -12% win. At 8 rounds it is -0.9%. Its per-round spread is ~40% of
>   its own value, so three samples could never have supported that claim.
>   Measure the variance first, then choose the round count.
> - **Chrome quantizes `performance.now()` to 0.1 ms.** A task with a 1.6 ms
>   median has ~16 ticks of resolution, so "1.6 vs 1.7 ms" is a one-tick
>   difference, not 6%. Prefer per-round sums over medians for sub-millisecond
>   tasks, and ignore anything at the 0.1 ms floor entirely.

## Size

> **These are release builds.** `cargo make web` runs `build-debug-all`, whose
> output is ~15% larger because it keeps panic messages and source paths. To
> reproduce the numbers here: `cargo make build-all && cargo make size-report`.

Full release pipeline (`build-std`, `panic=immediate-abort`, `wasm-bindgen`,
`wasm-opt -Oz`), Rust 1.98.0, Binaryen 126, 2026-09-09.

**Download size — gzip-9 bytes. Lower is better.**

| Module          | `scalar-z` | `simd-z` (ships) | `scalar-3` |  `simd-3` |
| --------------- | ---------: | ---------------: | ---------: | --------: |
| Main engine     |  1,668,652 |    **1,636,589** |  2,012,896 | 1,980,044 |
| Geometry worker |    703,722 |      **702,327** |    764,612 |   761,634 |
| Font worker     |  1,113,108 |    **1,107,791** |  1,212,668 | 1,167,620 |
| API             |    716,034 |      **714,616** |    786,629 |   783,744 |

**Uncompressed size — bytes on disk. This is what `ls` shows you.**

| Module          | `scalar-z` | `simd-z` (ships) |
| --------------- | ---------: | ---------------: |
| Main engine     |  4,653,282 |    **4,571,904** |
| Geometry worker |  1,820,491 |    **1,815,223** |
| Font worker     |  2,948,536 |    **2,911,530** |
| API             |  1,855,030 |    **1,850,829** |

The gap between the two tables is just compression: the engine is 4.6 MB on disk
and 1.6 MB over the wire. Users pay the gzip number; wasm compile time scales
with the uncompressed one.

**What each change costs, as a percentage of the shipping build:**

| Change                   | Main engine | Worker | Font worker |   API |
| ------------------------ | ----------: | -----: | ----------: | ----: |
| Enabling SIMD (`z`)      |       -1.9% |  -0.2% |       -0.5% | -0.2% |
| Raising opt-level to `3` |      +20.6% |  +8.7% |       +8.9% | +9.9% |

SIMD is size-neutral to slightly positive — it makes the binaries marginally
_smaller_. That is a code-generation difference, not evidence of a runtime
improvement. Raising the optimization level is the expensive one, and the
+20.6% on the main engine is the price of the ~1.85x mesh win above.

## `wasm-opt -O4` is a trap

There are two separate optimization knobs, and they are easy to confuse:

- **`rustc` `opt-level`** — `0/1/2/3/"s"/"z"`. There is **no `opt-level = 4`**.
  The release profile uses `"z"`.
- **`wasm-opt` (Binaryen) level** — `-O/-O2/-O3/-O4/-Os/-Oz`. The build tasks in
  `makes/` use `-Oz`.

Every crate declares `wasm-opt = ['-O4']` under
`[package.metadata.wasm-pack.profile.release]`, but the build does not use
wasm-pack — it runs `cargo build` plus `wasm-bindgen` plus `wasm-opt -Oz` from
cargo-make. That metadata has never taken effect. **Leave it that way.**

Measured with SIMD off, two runs of the (since removed) terrain harness, median
ms; positive = slower:

Two optimizers are involved, so each column names both: **rustc opt-level** first,
then **wasm-opt level**. Times are median ms; the change columns are
**positive = slower = worse**.

| Workload      | rustc `z`<br>wasm-opt `-Oz` | rustc `z`<br>wasm-opt `-O4` | change | rustc `3`<br>wasm-opt `-Oz` | rustc `3`<br>wasm-opt `-O4` | change |
| ------------- | --------------------------: | --------------------------: | -----: | --------------------------: | --------------------------: | -----: |
| mesh/Mapbox   |                      0.3053 |                      0.3322 |  +8.8% |                      0.1623 |                      0.1653 |  +1.8% |
| mesh/GSI      |                      0.2989 |                      0.3327 | +11.3% |                      0.1656 |                      0.1681 |  +1.5% |
| mesh_hoisted  |                      0.0708 |                      0.0943 | +33.1% |                      0.0552 |                      0.0601 |  +8.9% |
| polyline      |                      1.9457 |                      1.9791 |  +1.7% |                      1.3693 |                      1.4213 |  +3.8% |
| decode/Mapbox |                      0.0772 |                      0.0785 |  +1.6% |                      0.0767 |                      0.0758 |  -1.2% |
| inflate       |                      3.6832 |                      3.6834 |   0.0% |                      3.4020 |                      3.3784 |  -0.7% |

`-O4` makes the compute workloads **slower**, most sharply on the tightest loop
(+33%), and is neutral on the memory-bound ones. The likely reason is that
Binaryen optimizes for a straightforward execution model while V8 re-optimizes
the module in TurboFan anyway; `-O4`'s aggressive inlining enlarges functions in
ways that work against V8's own inlining and register allocation.

And it is not free in size (gzip-9, engine): `-Oz` 1,668,644 to `-O4` 1,689,488,
+1.2% — small, but paid for a slowdown. Raw grows more, 4,653,282 to 4,941,012
(+6.2%), which also costs wasm compile time.

**The optimization knob that actually buys speed is `rustc`'s, not Binaryen's:**

| rustc | wasm-opt | mesh time (ms)<br>lower better |      vs shipping | engine download<br>(gzip bytes) | vs shipping |
| ----- | -------- | -----------------------------: | ---------------: | ------------------------------: | ----------: |
| `z`   | `-Oz`    |            0.3053 _(shipping)_ |                - |             1,668,644 _(ships)_ |           - |
| `z`   | `-O4`    |                         0.3322 | **+8.8% slower** |                       1,689,488 |       +1.2% |
| `3`   | `-Oz`    |                         0.1623 |  **-47% faster** |                       2,012,888 |      +20.6% |
| `3`   | `-O4`    |                         0.1653 |      -46% faster |                       2,029,605 |      +21.6% |

## Worker-only `opt-level = 3`, measured in a browser

Raising `opt-level` to 3 for the geometry worker only — where the size cost is
smallest and the CPU work is concentrated — was measured and is recorded here as
a lead. **The profile and its build tasks have been removed**: they were opt-in,
nothing invoked them, and they predated the fallback. Left in place they would
have been a trap — `build-worker-speed` regenerates the worker's JS glue from a
different `opt-level`, which (unlike a SIMD/scalar difference) _does_ change the
glue, leaving the fallback binary paired with bindings it was not built against.

To pursue this, re-add a profile inheriting `release` with `opt-level = 3` for
`navara_wasm_worker`, and make sure the fallback **and** the selector are
regenerated after the worker is swapped. Measure with
`scripts/bench-examples.mjs`.

The numbers below come from a dedicated harness (since removed): headless
Chrome, a synthetic GSI DEM served to every tile request, a fixed camera over
Fuji, the two profiles alternating across 7 rounds each with a fresh browser
context per round, timing each worker task through a wrapped
`Worker.postMessage`.

Chrome 152, 960x640, 2026-09-09. Median ms per worker task:

| Worker task            | rustc `z` (ms) | rustc `3` (ms) | change<br>(- = faster) | samples |
| ---------------------- | -------------: | -------------: | ---------------------: | ------: |
| `constructTerrainMesh` |           6.70 |           4.60 |                 -31.3% |     224 |
| `warmUp`               |          13.80 |           8.50 |                 -38.4% |      84 |
| `getImageDataFromBlob` |           3.70 |           3.80 |                  +2.7% |     224 |
| `getWasmMemoryUsage`   |           0.10 |           0.10 |                   0.0% |     418 |

| Scene metric (ms) | rustc `z` | rustc `3` | change<br>(- = faster) |
| ----------------- | --------: | --------: | ---------------------: |
| `initMs`          |      39.6 |      39.5 |                  -0.3% |
| `firstTerrainMs`  |    1205.7 |    1181.0 |                  -2.0% |
| `lastTerrainMs`   |    1206.5 |    1181.7 |                  -2.1% |

This corroborates the microbenchmark and calibrates it. `constructTerrainMesh`
improves 31% in the real pipeline against the 45% the isolated function showed —
the difference is message deserialization, image handling, and transfer, which
`opt-level` does not help. `getImageDataFromBlob` is browser-side work and acts
as the control: it does not move.

The important caveat is the second table. **Time to terrain on screen improves
only ~2%**, because it is dominated by tile fetching and init, not worker CPU.
Worker cost is real but is not the critical path in this scene; it would matter
more under heavy panning, deep zoom stacks, or slower CPUs.

Worker size cost for that gain: 1,815,223 to 2,061,054 raw (+13.5%), +8.1%
gzipped.

## Conclusions

- **`simd128` is on, with a non-SIMD fallback shipped beside every module.**
  Enabling it costs no browser support: the effective floor stays Safari 15.0 /
  Chrome 96 / Firefox 79.
- **Do not expect SIMD to speed up geometry.** No real example page showed a
  difference across 8 rounds. The bottleneck is `f64` transcendental math, which
  WebAssembly SIMD cannot vectorize. Hand-written `core::arch::wasm32` intrinsics
  would not address it either; the one place they could help is bulk DEM decode,
  and only after Martini stops decoding each pixel ~6 times (below).
- **Switching `navara_math` to `f32` glam types to unlock glam's SIMD backend
  would trade globe precision for a speedup the profile does not show a need
  for.** ECEF coordinates need `f64`.
- **The best available terrain win is scalar, not vector:** hoist
  `mercator_y_to_lat` and the per-row/per-column `sin`/`cos` out of the
  `tile_triangles` inner loop — 4.1-4.3x with bit-identical output and no size
  cost. Note this applies to `tile_triangles`, which production only reaches as a
  flat-tile fallback; the main raster-DEM path is Martini.
- **Martini decodes each DEM pixel about six times.** `compute_errors` walks
  131,070 triangles calling `get_height` three times each — ~393,000
  `decode_height_from_dem` calls for a 65,536-pixel grid, with no cache.
  `compute_height_at_point` in the same file already caches decoded heights in a
  `Vec<f32>`; the Martini path does not. Unmeasured, but the most promising
  terrain lead.
- **`wasm-opt -O4` is not the lever it looks like.** 9-11% _slower_ than `-Oz`
  on mesh construction. The dead `wasm-opt = ['-O4']` metadata in every crate
  should stay dead.
- **Raising `rustc`'s `opt-level` is the real speed lever**, and the worker-only
  profile is the sane version: `constructTerrainMesh` -31% in a browser for +8.7%
  on the worker download, versus +21% gzip to raise the whole engine. But
  time-to-terrain moved only ~2% in that scene, so it is worth doing for CPU
  headroom under load, not for first paint.
