/**
 * Runtime WebAssembly feature detection.
 *
 * Every WASM module ships twice: the primary is built with `simd128`, and
 * `<crate>_bg.nosimd.wasm` beside it is the same code without it. Callers probe
 * with {@link hasWasmSimd} and hand the fallback URL to `init()` when SIMD is
 * missing, which keeps Navara's browser floor where the rest of its WebAssembly
 * features put it instead of raising it to Safari 16.4.
 *
 * See `guide/SIMD.md` for the measurements and the full feature floor.
 */

/**
 * A minimal module whose only function returns a `v128`, built from
 * `i32.const 0`, `i8x16.splat`, `i8x16.popcnt`. Runtimes without `simd128`
 * reject it during validation.
 */
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00,
  0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00,
  0xfd, 0x0f, 0xfd, 0x62, 0x0b,
]);

let simdSupported: boolean | undefined;

/**
 * Whether this runtime supports WebAssembly fixed-width SIMD (`simd128`).
 *
 * Validation only — nothing is instantiated and no network request is made — so
 * this is safe to call on the main thread and inside workers, where it must run
 * separately because each worker loads its own WASM.
 *
 * The result is cached: a runtime cannot gain or lose the feature mid-session.
 */
export function hasWasmSimd(): boolean {
  if (simdSupported === undefined) {
    try {
      simdSupported = WebAssembly.validate(SIMD_PROBE);
    } catch {
      // `WebAssembly` missing entirely, or validate() throwing on a hostile
      // shim: treat as unsupported and let the fallback load.
      simdSupported = false;
    }
  }
  return simdSupported;
}

/**
 * Picks the argument for a wasm-bindgen `init()`.
 *
 * Returns `undefined` when SIMD is supported, so `init()` resolves its own
 * default URL and the primary module loads unchanged; returns the fallback URL
 * otherwise.
 *
 * @param fallbackUrl URL of the module's `<crate>_bg.nosimd.wasm`.
 */
export function wasmInitInput(
  fallbackUrl: string,
): { module_or_path: string } | undefined {
  return hasWasmSimd() ? undefined : { module_or_path: fallbackUrl };
}
