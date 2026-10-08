import workerpool from "workerpool";

import { commonTasks } from "../tasks";

export { type CommonTasks } from "../tasks";

export * from "./transfer";
export { registerWasmMemoryProbe } from "../tasks/waitWasm";

let isInitialized = false;
export const registerTasks = (
  ...args: Parameters<typeof workerpool.worker>
) => {
  if (!isInitialized) {
    workerpool.worker(commonTasks);
    keepWorkerAliveOnAbort();
    isInitialized = true;
  }
  return workerpool.worker(...args);
};

/**
 * Register a no-op abort listener so a cancelled task does not terminate this
 * worker. Without any listener, workerpool kills the worker on
 * cancel-while-running and the next task pays a fresh WASM cold start
 * (`minWorkers: 0`, so nothing re-warms it) — expensive under fast camera
 * movement, where cancellations are routine. A synchronous WASM task cannot
 * be interrupted anyway; letting it finish and dropping the result costs the
 * same compute while keeping the warm worker in the pool.
 *
 * workerpool exposes `addAbortListener` only as a `worker` property it
 * attaches to each registered method (`worker.methods[name].worker`), hence
 * the lookup through a just-registered task.
 *
 * This only works together with the pool-side `workerTerminateTimeout` (see
 * `recyclingPool.ts`): the busy worker cannot even receive the cleanup
 * message until the running task finishes, so with the 1s default the pool
 * would force-terminate it anyway for any task with more than ~1s remaining.
 */
function keepWorkerAliveOnAbort() {
  const registered = commonTasks.warmUp as {
    worker?: { addAbortListener: (listener: () => Promise<void>) => void };
  };
  registered.worker?.addAbortListener(async () => {});
}
