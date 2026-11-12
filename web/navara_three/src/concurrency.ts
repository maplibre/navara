import { createConcurrencyManager } from "@navaramap/worker";

/** Default worker cap on mobile: limits thermal throttling AND peak memory —
 * every busy worker's WASM heap ratchets to its decode working set, so a
 * camera-move burst costs up to `workers × maxWorkerHeapBytes`. Two workers
 * halve that peak versus four at the cost of decode throughput. */
const MOBILE_MAX_WORKERS = 2;

export const createDefaultConcurrencyManager = (
  mobileOptimized: boolean,
  workerPoolSize?: number,
) => {
  // `||` also covers browsers that leave it undefined.
  const hardwareConcurrency = navigator.hardwareConcurrency || 1;
  if (workerPoolSize === undefined) {
    return createConcurrencyManager(
      mobileOptimized
        ? Math.min(hardwareConcurrency, MOBILE_MAX_WORKERS)
        : hardwareConcurrency,
    );
  }
  // NaN fails the comparison and resolves to 1.
  const poolSize =
    workerPoolSize >= 1
      ? Math.min(Math.floor(workerPoolSize), hardwareConcurrency)
      : 1;
  if (poolSize !== workerPoolSize) {
    console.warn(
      `workerPoolSize ${workerPoolSize} is clamped to ${poolSize} (an integer from 1 to navigator.hardwareConcurrency, which is ${hardwareConcurrency}).`,
    );
  }
  return createConcurrencyManager(poolSize);
};
