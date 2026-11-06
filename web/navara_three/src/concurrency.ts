import { createConcurrencyManager } from "@navaramap/worker";

/** Default worker cap on mobile (an explicit `workerPoolSize` overrides it):
 * limits thermal throttling AND peak memory — every busy worker's WASM heap
 * ratchets to its decode working set, so a camera-move burst costs up to
 * `workers × maxWorkerHeapBytes`. Two workers halve that peak versus four at
 * the cost of decode throughput. */
const MOBILE_MAX_WORKERS = 2;

export const createDefaultConcurrencyManager = (
  mobileOptimized: boolean,
  workerPoolSize?: number,
) => {
  const hardwareConcurrency = Math.max(navigator.hardwareConcurrency, 1);
  const poolSize =
    workerPoolSize ??
    (mobileOptimized
      ? Math.min(hardwareConcurrency, MOBILE_MAX_WORKERS)
      : hardwareConcurrency);
  // NaN fails the comparison and resolves to 1.
  const totalConcurrency =
    poolSize >= 1 ? Math.min(Math.floor(poolSize), hardwareConcurrency) : 1;
  return createConcurrencyManager(totalConcurrency);
};
