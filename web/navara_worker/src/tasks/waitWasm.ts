import { wasmInitInput } from "@navaramap/core";
import init, { type InitOutput } from "@navaramap/engine-worker";
// Non-SIMD build of the same module, loaded only when this runtime lacks
// `simd128`. Detection has to happen here, inside the worker: the main thread's
// result does not travel with the module.
import fallbackUrl from "@navaramap/engine-worker/navara_wasm_worker_bg.nosimd.wasm?url";

let WASM: Promise<InitOutput> | undefined;

export async function waitWasm(): Promise<InitOutput> {
  WASM ??= init(wasmInitInput(fallbackUrl));
  return WASM;
}

/**
 * Reports this worker's WASM linear memory size in bytes (0 when WASM is not
 * initialized yet). Linear memory only grows, so the main thread probes this
 * after settled tasks to decide when to recycle the worker.
 */
export async function getWasmMemoryUsage(): Promise<number> {
  if (!WASM) return 0;
  const { memory } = await WASM;
  return memory.buffer.byteLength;
}
