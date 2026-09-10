# WebAssembly SIMD

Navara builds all four WASM modules with `simd128`, set in `.cargo/config.toml`
and repeated in the release task in `makes/rust.toml` (that task's `RUSTFLAGS`
override the target configuration rather than merging with it — keep both in
sync).

**There is no scalar fallback.** A runtime without SIMD cannot load Navara at
all; see [Browser support](#browser-support).

## What SIMD actually buys

Measured three ways, it produced **no detectable speedup**:

| Method                                      | Result                                           |
| ------------------------------------------- | ------------------------------------------------ |
| Static attribution (`simd-attribution.mjs`) | 3 lane-math ops in Navara's own code, out of 750 |
| Node microbenchmarks                        | ±1% except a synthetic decode loop               |
| Real example pages in Chrome, 8 rounds      | every worker task's range overlaps               |

What it does buy is ~2% smaller binaries (engine gzip 1,668,652 → 1,636,589)
and the vector code paths inside SIMD-aware dependencies. Keep expectations
there; do not reach for SIMD to fix a performance problem in this codebase.

## Browser support

`simd128` is not the only post-MVP feature in these binaries — `rustc` enables
six more by default for `wasm32-unknown-unknown`:

```sh
rustc --print cfg --target wasm32-unknown-unknown | grep target_feature
# bulk-memory  multivalue  mutable-globals
# nontrapping-fptoint  reference-types  sign-ext
wasm-opt --print-features web/wasm/navara_engine/navara_wasm_bg.wasm -o /dev/null
```

Approximate first versions (verify against caniuse before relying on them):

| Feature                       | Chrome | Firefox |   Safari |
| ----------------------------- | -----: | ------: | -------: |
| `sign-ext`, `mutable-globals` |     74 |      61 |     13.0 |
| `multivalue`                  |     85 |      78 |     13.1 |
| `bulk-memory`                 |     75 |      79 |     15.0 |
| `nontrapping-fptoint`         |     75 |      64 |     15.0 |
| `reference-types`             |     96 |      79 |     15.0 |
| **`simd128`**                 | **91** |  **89** | **16.4** |

**Effective floor: Chrome 96, Firefox 89, Safari 16.4.** SIMD is what binds
Safari and Firefox; `reference-types` binds Chrome either way. Dropping
`simd128` would lower the floor to Safari 15.0 / Firefox 79 and cost ~2% in
size — the trade was considered and SIMD was kept.

### What happens below the floor

The module fails to **compile**, not to run: `WebAssembly.instantiate` rejects
with a `CompileError` as soon as it validates an unsupported opcode. The failure
is deterministic and happens at startup — no partially working engine, no slow
path. It surfaces in two places:

- **Main thread** — `await Promise.all([initCore(), initNavaraApi()])` in
  `ThreeView.init()` ([web/navara_three/src/index.ts](../web/navara_three/src/index.ts))
  rejects, so `await view.init()` rejects.
- **Workers** — the tile-worker pool and font worker load their own `.wasm`.
  Those failures happen inside the worker and do **not** reject `init()`, so
  they are easy to miss.

Applications that care should feature-detect before initializing, so the user
gets a real message instead of a `CompileError`. Validation is cheap and
synchronous:

```ts
/** `i32.const 0` + `i8x16.splat` + `i8x16.popcnt` — rejected without simd128. */
export const hasWasmSimd = (): boolean =>
  WebAssembly.validate(
    new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
      0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00,
      0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
    ]),
  );
```

Feature-detect rather than sniffing the user agent.

## Where the SIMD instructions land

"Is SIMD enabled" is not the useful question — it is a whole-program flag. The
useful question is which code got vectorized:

```sh
cargo make build-rust-all-wasm       # any build that leaves the name section
node scripts/simd-attribution.mjs
```

The script disassembles each module, counts `v128` instructions per function and
attributes them to the crate that emitted them, separating **lane math** (the
arithmetic SIMD can make faster) from `v128.load`/`store`/`const`, which are
overwhelmingly a wider `memcpy`.

| Module          | `v128` total | of which lane math | of which load/store/const |
| --------------- | -----------: | -----------------: | ------------------------: |
| Main engine     |       21,676 |                750 |                    20,926 |
| Geometry worker |        1,793 |                108 |                     1,685 |
| Font worker     |       11,181 |              3,224 |                     7,957 |
| API             |        1,598 |                114 |                     1,484 |

Scalar builds contain zero `v128` instructions, which is the control.

- **93-97% of the vector instructions in the engine, worker and API are data
  movement, not math** — wider copies of vertex and index buffers, and most of
  what `simd128` buys those modules.
- **Almost all genuine lane math is in dependencies.** The worker's 108 ops are
  `serde_json` (56), `simd_adler32` (46), `tracing_core` (2), `core`'s inlined
  `memchr` (1) — and 3 from Navara itself, all in `navara_core`'s
  `Plane::from_point_normal`. Nothing in the terrain, polyline or polygon
  builders. The font worker is the exception: 3,166 of its 3,224 lane-math ops
  are `tiny-skia`'s hand-written `simd128` raster pipeline, which Navara uses
  only for the **COLRv1 color-glyph path** (`color_raster.rs`), not for the
  common MSDF text path.
- At `opt-level = 3` the worker goes from 108 to 1,116 lane-math ops and
  Navara's own code finally appears. **LLVM's vectorizers are effectively off at
  `"z"`** — any plan depending on auto-vectorization also depends on the
  optimization level.

### Why terrain does not vectorize

`tile_triangles` ([crates/navara_geometry/src/tile.rs](../crates/navara_geometry/src/tile.rs))
costs, per vertex: `mercator_y_to_lat` (`exp` + `atan`), then `lle_to_xyz`'s
`sin`/`cos` of latitude and longitude plus a `sqrt` — roughly six `f64`
transcendental calls per vertex, ~25,000 per 64-segment tile.

WebAssembly SIMD has **no vector transcendentals** — no `f64x2.sin`, no vector
libm for wasm32 — so LLVM cannot vectorize these loops at any optimization
level. Three properties compound it: `FloatType` is `f64`, so a `v128` holds
only two lanes; the height callback is an opaque `&mut FnMut` pushing to a
growing `Vec`; and DEM sampling is strided, a gather rather than a contiguous
read.

### Why `bevy_math` / `glam` contributes nothing

`glam` does ship hand-written WebAssembly SIMD, and `simd128` switches it on
(`glam/src/f32.rs` selects the backend with `#[cfg(target_feature = "simd128")]`).
But that backend exists **only for the `f32` types**: `glam/src/f32/` carries
`wasm/`, `sse2/`, `neon/`, `coresimd/` and `scalar/` backends, while
`glam/src/f64/` has no backend directory at all.

[navara_math](../crates/navara_math/src/vertex.rs) aliases every public type to
the `f64` variants (`Vec3 = DVec3`, `Mat4 = DMat4`, `Quat = DQuat`), and the
built engine confirms it: all ~205 `glam` symbols are under `glam::f64::`. The
SIMD backend is compiled in and never called.

That is not an oversight to fix. ECEF coordinates are on the order of 6.4e6 m,
where `f32`'s 24-bit mantissa gives roughly half-metre resolution — visible
jitter. `f64` is correct for globe coordinates; the `f32` vertex buffers are
produced only after RTC translation has made the values small.

## Measurements in real example pages

`scripts/bench-examples.mjs` loads the shipped demo pages in headless Chrome,
swaps only the four `.wasm` artifacts between runs, and times each worker task
the engine dispatches:

```sh
node scripts/bench-examples.mjs --build              # build both variants first
node scripts/bench-examples.mjs --rounds 8 --only basemap/vector-map
node scripts/bench-examples.mjs --headed             # watch it run
```

Tile responses are recorded to `target/example-bench/tiles` on the first run and
replayed afterwards, so both variants see byte-identical input. The harness
aborts if the variant swap never applied — without that guard both runs would
silently load the same build.

Chrome 152, 8 rounds per variant, alternating order. CPU ms per page load:

| Example              | Worker task                       | scalar | simd | ranges  |
| -------------------- | --------------------------------- | -----: | ---: | ------- |
| `terrain/raster`     | `constructTerrainMesh`            |   1889 | 1872 | overlap |
| `basemap/vector-map` | `constructPolygonBatchedFeature`  |    996 | 1030 | overlap |
| `basemap/vector-map` | `parseMvtTile`                    |    917 |  909 | overlap |
| `basemap/vector-map` | `constructPolylineBatchedFeature` |    349 |  357 | overlap |

**Every row's per-round range overlaps.** There is no effect to report.

> Two traps worth repeating for anyone extending the harness:
>
> - **Three rounds is not enough.** At 3 rounds `parseMvtTile` looked like a
>   consistent -12% win; at 8 it is -0.9%. Its per-round spread is ~40% of its
>   own value. Measure the variance first, then choose the round count.
> - **Chrome quantizes `performance.now()` to 0.1 ms.** A task with a 1.6 ms
>   median has ~16 ticks of resolution, so "1.6 vs 1.7 ms" is one tick, not 6%.
>   Prefer per-round sums over medians for sub-millisecond tasks.

## Size

Full release pipeline (`build-std`, `panic=immediate-abort`, `wasm-bindgen`,
`wasm-opt -Oz`), Rust 1.98.0, Binaryen 126. `gzip -9` bytes, matching
`cargo make size-report`:

| Module          |    scalar | **simd (ships)** | change |
| --------------- | --------: | ---------------: | -----: |
| Main engine     | 1,668,652 |    **1,636,589** |  -1.9% |
| Geometry worker |   703,722 |      **702,327** |  -0.2% |
| Font worker     | 1,113,108 |    **1,107,791** |  -0.5% |
| API             |   716,034 |      **714,616** |  -0.2% |

SIMD makes the binaries marginally _smaller_. That is a code-generation
difference, not evidence of a runtime improvement.

> Note these are **release** numbers. `cargo make web` runs `build-debug-all`,
> whose output is ~15% larger because it keeps panic messages and source paths.
> Reproduce with `cargo make build-all && cargo make size-report`.

## Optimization level

Two knobs are easy to confuse. `rustc`'s `opt-level` is `0/1/2/3/"s"/"z"` —
**there is no `opt-level = 4`** — and the release profile uses `"z"`.
`wasm-opt` (Binaryen) has `-O/-O2/-O3/-O4/-Os/-Oz`, and the build tasks use
`-Oz`.

**`wasm-opt -O4` is a trap.** Measured with SIMD off, two runs, it is _slower_
than `-Oz`: +8.8% on `mesh/Mapbox`, +11.3% on `mesh/GSI`, +33.1% on the tightest
loop, and neutral on the memory-bound workloads. Binaryen optimizes for a
straightforward execution model while V8 re-optimizes the module in TurboFan
anyway, and `-O4`'s aggressive inlining works against V8's own inlining and
register allocation. It also costs +1.2% gzip and +6.2% raw. Every crate
declares `wasm-opt = ['-O4']` under `[package.metadata.wasm-pack]`, but the
build does not use wasm-pack, so it has never taken effect. **Leave it that
way.**

**`rustc`'s `opt-level` is the real lever**, at a real price:

| rustc | wasm-opt | mesh time (ms) | vs shipping | engine gzip | vs shipping |
| ----- | -------- | -------------: | ----------: | ----------: | ----------: |
| `z`   | `-Oz`    |         0.3053 |   _(ships)_ |   1,668,644 |   _(ships)_ |
| `z`   | `-O4`    |         0.3322 |       +8.8% |   1,689,488 |       +1.2% |
| `3`   | `-Oz`    |         0.1623 |    **-47%** |   2,012,888 |      +20.6% |
| `3`   | `-O4`    |         0.1653 |        -46% |   2,029,605 |      +21.6% |

Raising `opt-level` for the **geometry worker only** is the cheaper version:
measured in a browser it cut `constructTerrainMesh` from 6.70 ms to 4.60 ms
(-31%) for +8.7% on the worker download — but time-to-terrain moved only ~2%,
because tile fetching dominates that scene. Worth doing for CPU headroom under
load, not for first paint. If pursued, note that changing `opt-level` changes
the wasm-bindgen glue (unlike a SIMD/scalar difference, which does not), so the
worker's glue and binary must be regenerated together.

## Leads worth more than SIMD

- **Martini decodes each DEM pixel about six times.** `compute_errors`
  ([crates/martini/src/lib.rs](../crates/martini/src/lib.rs)) walks 131,070
  triangles calling `get_height` three times each — ~393,000
  `decode_height_from_dem` calls for a 65,536-pixel grid, with no cache.
  `compute_height_at_point` in
  [raster_dem_data.rs](../crates/navara_tile_component/src/terrain/raster_dem_data.rs)
  already caches decoded heights in a `Vec<f32>`; the Martini path does not.
  Unmeasured, but the most promising terrain lead.
- **Hoisting the per-row/per-column transcendentals out of `tile_triangles`**
  measured 4.1-4.3x with bit-identical output and no size cost. Note this
  applies to `tile_triangles`, which production only reaches as a flat-tile
  fallback; the main raster-DEM path is Martini.
- **Hand-written `core::arch::wasm32` intrinsics would not help geometry** — the
  bottleneck is `f64` transcendental math. The one place they could help is bulk
  DEM decode, and only after the Martini caching above.
