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

/** One holder's claim on the shared worker pool; see `acquireWorkerPool`. */
export type WorkerPoolLease = {
  /** The pool's concurrency manager, which may be another holder's. */
  manager: ConcurrencyManager;
  /** Whether this claim created the pool, so its holder warms it up. */
  created: boolean;
  /** Drops this claim; the last release terminates the pool. Idempotent. */
  release: () => void;
};

const NOT_ACQUIRED =
  "The worker pool is not acquired: call acquireWorkerPool() first, and do not use the pool after its last holder released it.";

const {
  acquireWorkerPool,
  workerPoolHolders,
  sharedWorkerPoolSize,
  warmUpWorkerPool,
  canWorkerPoolAcceptTasks,
  workerPoolLoad,
  reserveWorkerCore,
  workerPoolReservedSlots,
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
        maxWorkerHeapBytes: number | undefined;
      }
    | undefined;
  /** Cores held by threads outside the pool; outlives the pool itself, so a
   * reservation taken before initialization (or across a re-init) holds. */
  let coreReservations = 0;
  let holders = 0;

  return {
    /**
     * Claims the page-wide worker pool, creating it on the first claim. Every
     * view shares the one pool so their tasks contend for the same cores;
     * `url`, `manager` and `options` of later claims are ignored while the
     * pool lives (a differing pool size or heap budget logs a warning).
     */
    acquireWorkerPool: (
      url: string,
      manager: ConcurrencyManager,
      options?: RecyclingWorkerPoolOptions,
    ): WorkerPoolLease => {
      const created = !worker;
      if (!worker) {
        worker = {
          // Recycles worker threads to bound WASM linear memory growth; see
          // recyclingPool.ts for the policy.
          pool: new RecyclingWorkerPool(url, manager.total, options),
          manager,
          maxWorkerHeapBytes: options?.maxWorkerHeapBytes,
        };
        worker.pool.setReservedSlots(coreReservations);
      } else if (
        manager.total !== worker.manager.total ||
        options?.maxWorkerHeapBytes !== worker.maxWorkerHeapBytes
      ) {
        console.warn(
          `The shared worker pool keeps its size (${worker.manager.total}) and worker heap budget (${worker.maxWorkerHeapBytes ?? "default"}); this claim asked for ${manager.total} and ${options?.maxWorkerHeapBytes ?? "default"}.`,
        );
      }
      holders++;

      let released = false;
      return {
        manager: worker.manager,
        created,
        release: () => {
          if (released) return;
          released = true;
          holders--;
          if (holders === 0 && worker) {
            worker.pool.terminate();
            worker = undefined;
          }
        },
      };
    },
    /** Live claims on the pool; see `acquireWorkerPool`. */
    workerPoolHolders: () => holders,
    /** Worker count of the live pool; undefined while none exists. */
    sharedWorkerPoolSize: (): number | undefined => worker?.manager.total,
    /**
     * Pre-initializes WASM on the workers so that upcoming tasks don't pay
     * the initialization latency. Warms a single worker and resolves once
     * it is ready; the rest warm in the background.
     */
    warmUpWorkerPool: () => {
      invariant(worker, NOT_ACQUIRED);
      return worker.pool.warmUp();
    },
    /**
     * Whether at least one worker is under its WASM heap budget. While false
     * the engine's worker-task intake must pause so the draining workers
     * reach a task boundary and recycle.
     */
    canWorkerPoolAcceptTasks: () => worker?.pool.canAcceptTasks() ?? true,
    /**
     * Tasks the pool's workers have running or queued, including tasks
     * cancelled while running; see RecyclingWorkerPool.load.
     */
    workerPoolLoad: () => worker?.pool.load() ?? 0,
    /**
     * Hold one core for a thread outside the pool (a font worker, a splat
     * decoder) while it works: one pool slot stops taking tasks and its
     * worker idles once its queued tasks finish. Returns the release
     * function; calling it again is a no-op. At least one slot always keeps
     * taking tasks.
     */
    reserveWorkerCore: (): (() => void) => {
      coreReservations++;
      worker?.pool.setReservedSlots(coreReservations);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        coreReservations--;
        worker?.pool.setReservedSlots(coreReservations);
      };
    },
    /** Pool slots kept free for threads outside the pool right now. */
    workerPoolReservedSlots: () => worker?.pool.reservedSlots() ?? 0,
    worker: () => {
      invariant(worker, NOT_ACQUIRED);
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
  acquireWorkerPool,
  workerPoolHolders,
  sharedWorkerPoolSize,
  warmUpWorkerPool,
  canWorkerPoolAcceptTasks,
  workerPoolLoad,
  reserveWorkerCore,
  workerPoolReservedSlots,
  workerPoolStats,
  workerPoolHeapStats,
  probeWorkerPoolHeap,
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
