# SIMD measurements

All comparisons keep optimization at `z` and toggle SIMD/vectorization only.

**Lower milliseconds are better. Positive improvement means faster.**

## Native Rust

Measured on an Apple M4 Pro with Rust 1.98.0, 2026-09-11. Each time below is
for **16,384 items**, averaged over eight paired rounds.

The [mock benchmark](../crates/navara_core/examples/simd_native.rs) calls real
Navara APIs. Rust's `Instant` measures the work inside a native executable;
JavaScript only launches the processes. Input generation, allocation, and
output checksums are outside the timed region. Both variants produce identical
output checksums.

Before = LLVM auto-vectorization disabled. After = enabled. Both builds use
`opt-level = "z"`.

| Rust workload                | Before ms | After ms |
| ---------------------------- | --------: | -------: |
| Plane construction           |    0.0232 |   0.0233 |
| Bounding-box culling         |    0.0077 |   0.0077 |
| Point transforms             |    0.0302 |   0.0301 |
| High/low coordinate encoding |    0.0374 |   0.0376 |
| Globe coordinates            |    0.1026 |   0.1027 |

None of these workloads showed a clear improvement.

### What the compiler vectorized

At `z`, enabling the auto-vectorizers adds no vector math to these mock kernels.
Culling already has a vector absolute-value operation in both controls.

Inspect `target/simd-native/z-{off,on}/vectorization.json`, `code.ll`, and
`code.s` for the emitted instructions and source locations.

These are warm, contiguous mock batches. Their vectorization and speedups do
not imply the same behavior in an ECS workload or in WebAssembly. The controls
use Rust's [`no-vectorize-loops` and `no-vectorize-slp` flags](https://doc.rust-lang.org/rustc/codegen-options/index.html#no-vectorize-loops);
explicit SIMD in dependencies remains enabled in both native builds.

## Browser frame time

Measured in Chrome 152.0.7977.84 on the same machine. Five paired rounds,
eight seconds per sample, 1280×800, four workers. All 30 measured page loads
completed successfully. Both WASM builds use the shipping optimization level
`z`; only `simd128` is toggled.

**Complete frame CPU time** includes feature updates, the Rust engine update,
event handling, and rendering submission. The old render-only measurement
missed the engine update.

| Example              | SIMD OFF ms | SIMD ON ms | Improvement | 95% improvement range |
| -------------------- | ----------: | ---------: | ----------: | --------------------: |
| `terrain/raster`     |       1.401 |      1.379 |       +1.6% |        -0.7% to +4.1% |
| `basemap/vector-map` |       1.411 |      1.414 |       -0.2% |        -2.8% to +2.0% |
| `gis/text`           |       1.245 |      1.218 |       +2.2% |        -4.5% to +8.5% |

**No clear average frame-time improvement in these examples.** Every range
includes zero. The slower frames (95th percentile) in vector-map increased
from 2.60 to 2.80 ms; SIMD did not improve its tail latency either.

The **frame interval** was **8.33 ms before and after** for all three examples
(about 120 FPS). This includes scheduling, GPU-related waits, and vsync; it is
not a measurement of GPU execution time alone.

These are warmed, fixed-camera scenes with continuous rendering forced on.
They do not measure tile-loading speed or camera navigation. Each table entry
is the mean of the per-round means. Improvement is `100 × (1 − after/before)`;
the uncertainty range resamples whole before/after round pairs, rather than
treating thousands of adjacent frames as independent trials.

## Reproduce

Run everything sequentially, with other builds and benchmarks stopped:

```sh
cargo make bench-simd
```

Or run either comparison separately:

```sh
node scripts/bench-simd-native.mjs --rounds 8
node scripts/bench-examples.mjs --build --headed --rounds 5
```

The browser defaults to terrain/raster, basemap/vector-map, and gis/text.
Use `--only terrain/raster` (or comma-separated names) to select examples,
`--workers 4` to set the worker pool, and `--frame-window 8000` for the sample
window in milliseconds. Omit `--build` to reuse previously built variants;
rebuild after changing Rust code.

Raw results: `target/simd-native/results.json` and
`target/example-bench/frames.json`. The browser also saves screenshots for both
variants and records/replays external assets from `target/example-bench/tiles`.

For WASM instruction attribution, after a benchmark build:

```sh
node scripts/simd-attribution.mjs --dir target/example-bench/simd
node scripts/simd-attribution.mjs --dir target/example-bench/scalar
```

Instruction counts show emitted code, including dependency intrinsics; they
are not timing measurements. The scalar WASM control has zero SIMD instructions.
