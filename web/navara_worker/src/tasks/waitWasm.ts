import init, { type InitOutput } from "@navaramap/engine-worker";

let WASM: Promise<InitOutput> | undefined;

export async function waitWasm(): Promise<InitOutput> {
  WASM ??= init();
  return WASM;
}

const extraWasmMemoryProbes: (() => number)[] = [];

/**
 * Adds another WASM module's linear memory (e.g. a decoder a task module
 * instantiates in this worker) to {@link getWasmMemoryUsage}.
 */
export function registerWasmMemoryProbe(probe: () => number) {
  extraWasmMemoryProbes.push(probe);
}

/**
 * Reports this worker's WASM linear memory size in bytes (0 when no WASM is
 * initialized yet). Linear memory only grows, so the main thread probes this
 * after settled tasks to decide when to recycle the worker.
 */
export async function getWasmMemoryUsage(): Promise<number> {
  let bytes = WASM ? (await WASM).memory.buffer.byteLength : 0;
  for (const probe of extraWasmMemoryProbes) {
    bytes += probe();
  }
  return bytes;
}
