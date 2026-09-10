import { type InitOutput } from "@navaramap/engine-worker";
// Generated selector. The probe runs here, inside the worker: a worker loads
// its own WASM and the main thread's detection result does not travel with it.
import init from "@navaramap/engine-worker/auto";

let WASM: Promise<InitOutput> | undefined;

export async function waitWasm(): Promise<InitOutput> {
  WASM ??= init();
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
