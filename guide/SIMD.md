# WebAssembly SIMD

Navara enables standard WebAssembly `simd128` for all four WASM modules. The flags
live in `.cargo/config.toml` and in the release build task in `makes/rust.toml`.
Keep both in sync: the release task sets `RUSTFLAGS`, which overrides the target
configuration.

**Summary of the investigation:** enabling `simd128` is safe, slightly reduces
binary size, and is essentially free — but it does not speed up Navara's own
geometry code. LLVM auto-vectorizes almost nothing in this workspace at the
shipped `opt-level = "z"`, and the parts that do vectorize live in dependencies.
The two levers that _do_ move terrain mesh time are the optimization level
(~1.85x, at a ~21% download-size cost) and hoisting redundant transcendentals out
of the vertex loop (~4x, at no size cost). In a real browser scene, raising just
the worker's optimization level cut `constructTerrainMesh` by 31% but moved
time-to-terrain only ~2%, because tile fetching dominates that path. Details and
measurements below.

The generated modules require a runtime with WebAssembly SIMD, with no scalar
fallback. Chrome 91, Firefox 89, and Safari 16.4 are the baselines; Safari is the
binding constraint. Supporting older runtimes would mean shipping separate scalar
artifacts and feature-detecting before initializing each module, including
workers. SIMD does not require shared memory or cross-origin isolation.

Core globe coordinates remain `f64`; the TypeScript API and worker message
formats are unchanged. Release builds still use `opt-level = "z"` and the
existing `wasm-opt -Oz` pass.

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

| Module          | v128 total | lane math | load/store/const |
| --------------- | ---------: | --------: | ---------------: |
| Main engine     |     21,676 |       750 |           20,926 |
| Geometry worker |      1,793 |       108 |            1,685 |
| Font worker     |     11,181 |     3,224 |            7,957 |
| API             |      1,598 |       114 |            1,484 |

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

## Benchmark

```sh
cargo make bench-terrain-simd
node scripts/bench-terrain-simd.mjs --skip-build   # re-measure existing artifacts
```

Requires the repository's Rust toolchain and WASM target, `wasm-bindgen`,
`wasm-opt`, `wasm-dis`, and Node. Results and the four compiled variants land in
`target/terrain-simd-bench/`.

The benchmark compiles [crates/navara_geometry/examples/terrain_simd_bench.rs](../crates/navara_geometry/examples/terrain_simd_bench.rs)
four ways — SIMD off/on, crossed with `opt-level` `z`/`3` — and runs
`wasm-bindgen` and `wasm-opt -Oz` over each. Unlike the shipping release task it
uses the normal precompiled standard library, without the immediate-abort
rebuild, so its binary sizes are benchmark sizes, not engine download sizes.

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

Median ms/iteration, Node 25.2.1 on an Apple M4 Pro (macOS ARM64), 2026-09-09.
Last three columns are the change from enabling SIMD at each optimization level,
and the change from `z` to `3` with SIMD off.

| Workload               | scalar-z | simd-z | scalar-3 | simd-3 | simd@z |     simd@3 |  o3@scalar |
| ---------------------- | -------: | -----: | -------: | -----: | -----: | ---------: | ---------: |
| decode/Mapbox          |   0.0790 | 0.0790 |   0.0768 | 0.0695 |  -0.1% |  **-9.6%** |      -2.8% |
| decode/Terrarium       |   0.0781 | 0.0783 |   0.0764 | 0.0695 |  +0.3% |  **-8.9%** |      -2.2% |
| decode/GSI             |   0.1859 | 0.2327 |   0.2410 | 0.0706 | +25.2% | **-70.7%** |     +29.7% |
| mesh/Mapbox            |   0.3068 | 0.3074 |   0.1676 | 0.1672 |  +0.2% |      -0.3% | **-45.4%** |
| mesh/Terrarium         |   0.3038 | 0.3003 |   0.1673 | 0.1673 |  -1.2% |       0.0% | **-44.9%** |
| mesh/GSI               |   0.3055 | 0.3036 |   0.1642 | 0.1654 |  -0.6% |      +0.7% | **-46.3%** |
| mesh_hoisted/Mapbox    |   0.0713 | 0.0710 |   0.0555 | 0.0557 |  -0.4% |      +0.3% |     -22.0% |
| mesh_hoisted/Terrarium |   0.0714 | 0.0714 |   0.0562 | 0.0560 |   0.0% |      -0.3% |     -21.3% |
| mesh_hoisted/GSI       |   0.0748 | 0.0751 |   0.0573 | 0.0568 |  +0.4% |      -0.8% |     -23.4% |
| polyline               |   1.9711 | 1.9773 |   1.3868 | 1.4018 |  +0.3% |      +1.1% | **-29.6%** |
| inflate                |   3.7592 | 3.7309 |   3.4310 | 3.4173 |  -0.8% |      -0.4% |      -8.7% |

Reading of these numbers:

- **SIMD does nothing measurable for real terrain mesh construction, polyline
  construction, or inflate**, at either optimization level. Every one of those
  deltas is within run-to-run noise.
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

## Size

Full release builds through the production pipeline (`build-std`,
`panic=immediate-abort`, `wasm-bindgen`, `wasm-opt -Oz`), measured 2026-09-09
with Rust 1.98.0 and Binaryen 126. Bytes after gzip-9.

| Module          |  scalar-z |    simd-z |  scalar-3 |    simd-3 |
| --------------- | --------: | --------: | --------: | --------: |
| Main engine     | 1,668,652 | 1,636,589 | 2,012,896 | 1,980,044 |
| Geometry worker |   703,722 |   702,327 |   764,612 |   761,634 |
| Font worker     | 1,113,108 | 1,107,791 | 1,212,668 | 1,167,620 |
| API             |   716,034 |   714,616 |   786,629 |   783,744 |

SIMD is size-neutral to slightly positive: -1.9% gzip on the main engine, -0.2%
on the worker, -0.5% on the font worker. These are code-generation differences,
not evidence of a runtime improvement.

`opt-level = 3` costs **+20.6% gzip on the main engine** (1.64 MB to 1.98 MB),
+8.7% on the worker, +8.9% on the font worker, and +9.9% on the API. That is the
price of the ~1.9x mesh-construction win above.

Sizes above use the `gzip -9` CLI, matching `cargo make size-report`. Note that
Node's `zlib.gzipSync({level: 9})` produces noticeably larger output for the same
bytes (741,690 vs 702,327 for the worker), so absolute figures from
`scripts/bench-worker-speed.mjs` are not comparable with this table — only ratios
within one tool are.

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

Measured with SIMD off, two runs (`BENCH_SIMD=0 BENCH_WASM_OPT=Oz,O4`), median
ms; positive = slower:

| Workload      | z + `-Oz` | z + `-O4` | `-O4` @ z | 3 + `-Oz` | 3 + `-O4` | `-O4` @ 3 |
| ------------- | --------: | --------: | --------: | --------: | --------: | --------: |
| mesh/Mapbox   |    0.3053 |    0.3322 |     +8.8% |    0.1623 |    0.1653 |     +1.8% |
| mesh/GSI      |    0.2989 |    0.3327 |    +11.3% |    0.1656 |    0.1681 |     +1.5% |
| mesh_hoisted  |    0.0708 |    0.0943 |    +33.1% |    0.0552 |    0.0601 |     +8.9% |
| polyline      |    1.9457 |    1.9791 |     +1.7% |    1.3693 |    1.4213 |     +3.8% |
| decode/Mapbox |    0.0772 |    0.0785 |     +1.6% |    0.0767 |    0.0758 |     -1.2% |
| inflate       |    3.6832 |    3.6834 |      0.0% |    3.4020 |    3.3784 |     -0.7% |

`-O4` makes the compute workloads **slower**, most sharply on the tightest loop
(+33%), and is neutral on the memory-bound ones. The likely reason is that
Binaryen optimizes for a straightforward execution model while V8 re-optimizes
the module in TurboFan anyway; `-O4`'s aggressive inlining enlarges functions in
ways that work against V8's own inlining and register allocation.

And it is not free in size (gzip-9, engine): `-Oz` 1,668,644 to `-O4` 1,689,488,
+1.2% — small, but paid for a slowdown. Raw grows more, 4,653,282 to 4,941,012
(+6.2%), which also costs wasm compile time.

**The optimization knob that actually buys speed is `rustc`'s, not Binaryen's:**

| Configuration          | mesh/Mapbox |  vs base | engine gzip | vs base |
| ---------------------- | ----------: | -------: | ----------: | ------: |
| `z` + `-Oz` (shipping) |      0.3053 |        - |   1,668,644 |       - |
| `z` + `-O4`            |      0.3322 |    +8.8% |   1,689,488 |   +1.2% |
| `3` + `-Oz`            |      0.1623 | **-47%** |   2,012,888 |  +20.6% |
| `3` + `-O4`            |      0.1653 |     -46% |   2,029,605 |  +21.6% |

## Worker-only `opt-level = 3`, measured in a browser

A `release-worker-speed` profile in the root `Cargo.toml` raises the optimization
level for the geometry worker only, where the size cost is smallest and the CPU
work is concentrated:

```sh
cargo make build-worker-speed          # build and install the profile
node scripts/bench-worker-speed.mjs --build
```

`scripts/bench-worker-speed.mjs` swaps only the worker artifact into a real
scene — headless Chrome, a synthetic GSI DEM served to every tile request, a
fixed camera over Fuji — and alternates the two profiles across 7 rounds each,
with a fresh browser context per round. It wraps `Worker.postMessage` to time
each worker task individually, and refuses to run if the candidate needs imports
the baseline wrapper does not provide.

Chrome 152, 960x640, 2026-09-09. Median ms per worker task:

| Worker task            | baseline (`z`) | speed (`3`) |  delta | samples |
| ---------------------- | -------------: | ----------: | -----: | ------: |
| `constructTerrainMesh` |           6.70 |        4.60 | -31.3% |     224 |
| `warmUp`               |          13.80 |        8.50 | -38.4% |      84 |
| `getImageDataFromBlob` |           3.70 |        3.80 |  +2.7% |     224 |
| `getWasmMemoryUsage`   |           0.10 |        0.10 |   0.0% |     418 |

| Scene metric     | baseline |  speed | delta |
| ---------------- | -------: | -----: | ----: |
| `initMs`         |     39.6 |   39.5 | -0.3% |
| `firstTerrainMs` |   1205.7 | 1181.0 | -2.0% |
| `lastTerrainMs`  |   1206.5 | 1181.7 | -2.1% |

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

- **Keep `simd128` enabled.** It costs no measurable runtime and slightly reduces
  binary size, and it gives dependencies (`tiny-skia`, `miniz_oxide`,
  `simd_adler32`, `serde_json`) their vector paths. Its one real cost is the
  runtime baseline — Safari 16.4+, no scalar fallback — so the decision is a
  browser-support decision, not a performance one. Expect wider `memcpy` and
  little else for Navara's own code.
- **Do not expect SIMD to speed up geometry.** The bottleneck is `f64`
  transcendental math, which WebAssembly SIMD cannot vectorize. Hand-writing
  `core::arch::wasm32` intrinsics for the terrain path would not address it.
- **The best available terrain win is scalar, not vector:** hoist
  `mercator_y_to_lat` and the per-row/per-column `sin`/`cos` out of the
  `tile_triangles` inner loop. The prototype shows 4.1-4.3x on mesh construction
  at the shipped `opt-level = "z"`, with bit-identical output and no size cost —
  more than raising `opt-level` buys, for free. This is not yet applied to
  production code.
- **`wasm-opt -O4` is not the lever it looks like.** It is 9-11% _slower_ than
  `-Oz` on mesh construction (33% on the tightest loop) and still costs size. The
  dead `wasm-opt = ['-O4']` metadata in every crate should stay dead.
- **Raising `opt-level` is a real but expensive option, and the worker-only
  profile is the sane version of it.** It cuts `constructTerrainMesh` 31% in a
  real browser scene for +8.1% on the worker download, versus +21% gzip to raise
  the whole engine. But time-to-terrain moved only ~2% in that scene, so this is
  worth doing for CPU headroom under load, not for first-paint. Validate against
  a fetch-bound real-tile scene before shipping it.
