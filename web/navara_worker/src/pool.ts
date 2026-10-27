import invariant from "tiny-invariant";
import type { Promise } from "workerpool";
import type { ExecOptions } from "workerpool/types/types";

import type { ConcurrencyManager } from "./manager";
import {
  RecyclingWorkerPool,
  type RecyclingWorkerPoolOptions,
} from "./recyclingPool";
import { type CommonTasks } from "./worker";

export type { Promise } from "workerpool";
export type {
  RecyclingWorkerPoolOptions,
  WorkerPoolHeapStats,
  WorkerPoolStats,
} from "./recyclingPool";

const {
  initializeWorkerPool,
  terminateWorkerPool,
  warmUpWorkerPool,
  worker,
  workerPoolStats,
  workerPoolHeapStats,
  probeWorkerPoolHeap,
} = (() => {
  // Restrict access to this object.
  let worker:
    | {
        pool: RecyclingWorkerPool;
        manager: ConcurrencyManager;
      }
    | undefined;

  return {
    initializeWorkerPool: (
      url: string,
      manager: ConcurrencyManager,
      options?: RecyclingWorkerPoolOptions,
    ) => {
      if (worker) {
        throw new Error("Worker pool has already been initialized.");
      }

      worker = {
        // Recycles worker threads to bound WASM linear memory growth; see
        // recyclingPool.ts for the policy.
        pool: new RecyclingWorkerPool(url, manager.total, options),
        manager,
      };
    },
    terminateWorkerPool: () => {
      if (worker) {
        worker.pool.terminate();
        worker = undefined;
      }
    },
    /**
     * Pre-initializes WASM on the workers so that upcoming tasks don't pay
     * the initialization latency. Warms a single worker and resolves once
     * it is ready; the rest warm in the background.
     */
    warmUpWorkerPool: () => {
      invariant(worker, "initializeWorkerPool() must be invoked first.");
      return worker.pool.warmUp();
    },
    worker: () => {
      invariant(worker, "initializeWorkerPool() must be invoked first.");
      return {
        pool: worker.pool,
        manager: worker.manager,
      };
    },
    workerPoolStats: () => worker?.pool.stats(),
    /** Last-probed WASM heap per worker; see RecyclingWorkerPool.heapStats. */
    workerPoolHeapStats: () => worker?.pool.heapStats(),
    /** Requests fresh heap probes (coalesced per worker; display-rate safe). */
    probeWorkerPoolHeap: () => worker?.pool.probeHeap(),
  };
})();

export {
  initializeWorkerPool,
  terminateWorkerPool,
  warmUpWorkerPool,
  workerPoolStats,
  workerPoolHeapStats,
  probeWorkerPoolHeap,
};

export const canWorkerProcessImmediately = () => {
  const { pool, manager } = worker();
  // Also pauses intake while every worker is over its WASM heap budget
  // (draining); a recycled worker restores capacity moments later.
  return manager.canIncrement() && pool.canAcceptTasks();
};

export type { ExecOptions } from "workerpool/types/types";

type GetTaskName<Task> =
  Task extends Record<string, unknown> ? keyof Task : string;

type AnyFunction = (...args: any) => any;

export type WorkerTask<T extends Record<string, AnyFunction>> = T & CommonTasks;

export type TaskParams<
  Task extends CommonTasks,
  Name extends keyof Task,
> = Parameters<
  Task[Name] extends AnyFunction ? Task[Name] : (...args: unknown[]) => unknown
>;
type MethodReturnType<
  Task extends CommonTasks,
  Name extends GetTaskName<Task>,
  R = Awaited<ReturnType<Task[Name]>>,
> = R extends infer U ? U : R;

export function queueTask<
  Task extends CommonTasks,
  Name extends GetTaskName<Task>,
>(
  method: Name,
  params?: TaskParams<Task, Name>,
  options?: ExecOptions,
): Promise<MethodReturnType<Task, Name>> {
  const { pool, manager } = worker();

  manager.increment();

  try {
    return (
      pool
        .exec(method, params, options)
        // `finally` doesn't work, so use `then()` and `catch()` to ensure that `manager.decrement()` is invoked.
        .then((p) => {
          manager.decrement();
          // workerpool types the result as the task's raw return type, but it
          // resolves with the awaited value.
          return p as MethodReturnType<Task, Name>;
        })
        .catch((e) => {
          manager.decrement();
          throw e;
        })
    );
  } catch (e) {
    manager.decrement();
    throw e;
  }
}
