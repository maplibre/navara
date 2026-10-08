import invariant from "tiny-invariant";
import workerpool from "workerpool";
import type { Promise as WorkerpoolPromise } from "workerpool";
import type Pool from "workerpool/types/Pool";
import type { ExecOptions } from "workerpool/types/types";

// WASM linear memory only grows, so each worker's heap ratchets up to its
// peak decode working set and never returns memory to the OS. The only way
// to release it is to terminate the worker thread (the wasm-bindgen glue
// caches its instance and skips re-initialization within a worker), so this
// pool recycles worker threads.
//
// Each worker gets its own single-worker workerpool (a "slot") so it can be
// recycled independently at its own task boundaries: after each settled task
// the slot's actual heap size is probed ("getWasmMemoryUsage"); once it
// exceeds the budget the slot stops receiving new tasks, and as soon as its
// in-flight tasks drain it is terminated and replaced. This keeps memory
// bounded even under sustained load (no pool-wide idle moment is required)
// and never discards more than one warm WASM instance at a time. The
// trade-off versus a single shared queue is possible head-of-line blocking
// within a slot, but upstream backpressure (ConcurrencyManager) keeps
// per-slot queues shallow.
//
// A burst that stays under the heap budget would otherwise keep its heaps
// forever, so an idle sweep additionally recycles every used slot once the
// pool has been quiet for RECYCLE_IDLE_MS.
//
// Recycled slots are pre-warmed immediately with a fire-and-forget "warmUp"
// task so the next real task doesn't pay WASM initialization latency.

/**
 * WASM linear memory budget per worker; a worker measured over this budget
 * is recycled. Must be comfortably above the post-init baseline heap, or
 * recycling would thrash.
 */
export const MAX_WORKER_HEAP_BYTES_DEFAULT = 256 * 1024 * 1024;
/**
 * Backstop for when heap probes cannot run (a failed probe already recycles
 * conservatively, so this only matters if probing silently stalls).
 */
export const RECYCLE_AFTER_TASKS_BACKSTOP = 128;
export const RECYCLE_IDLE_MS = 5_000;
/**
 * How long workerpool waits for a worker to acknowledge a cleanup message
 * (sent on cancel-while-running) before force-terminating it. A worker busy
 * in a synchronous WASM task cannot respond until the task finishes, so the
 * default (1s) would terminate exactly the long-running tasks the worker-side
 * abort listener is meant to keep alive (see `keepWorkerAliveOnAbort`). Must
 * comfortably exceed the longest expected task; a genuinely wedged worker
 * still gets terminated once this elapses.
 */
export const WORKER_TERMINATE_TIMEOUT_MS = 30_000;

export type RecyclingWorkerPoolOptions = {
  /** Overrides {@link MAX_WORKER_HEAP_BYTES_DEFAULT}. */
  maxWorkerHeapBytes?: number;
};

type Slot = {
  pool: Pool;
  /** Settled tasks since this slot's pool was (re)created. */
  tasksSinceSpawn: number;
  /** Dispatched but not yet settled tasks, including warm-ups and probes. */
  inflight: number;
  /** Set once the slot exceeds its heap budget; drained slots recycle. */
  draining: boolean;
  /** Whether a heap probe is already in flight (probes are coalesced). */
  probing: boolean;
  /** WASM heap size from the most recent probe; undefined until the first
   * probe settles and after a recycle. Point-in-time — see {@link heapStats}. */
  lastHeapBytes: number | undefined;
};

export type WorkerPoolStats = ReturnType<Pool["stats"]> & {
  tasksSinceSpawn: number;
};

export type WorkerPoolHeapStats = {
  /** Last probed WASM heap per slot (undefined = not probed yet). */
  perSlot: (number | undefined)[];
  /** Sum of the probed heaps. */
  totalBytes: number;
  /** The per-worker budget slots are recycled against. */
  maxWorkerHeapBytes: number;
};

const createPool = (url: string) =>
  workerpool.pool(url, {
    // One worker per pool so each worker can be recycled independently.
    maxWorkers: 1,
    // Avoid oversubscribing CPU when combined with other systems (e.g., the font worker).
    minWorkers: 0,
    workerTerminateTimeout: WORKER_TERMINATE_TIMEOUT_MS,
    workerOpts: {
      type: import.meta.env.PROD ? undefined : "module",
    },
  });

export class RecyclingWorkerPool {
  private readonly url: string;
  private readonly maxWorkerHeapBytes: number;
  private readonly slots: Slot[];
  private idleSweepTimer: ReturnType<typeof setTimeout> | undefined;
  private terminated = false;

  constructor(
    url: string,
    maxWorkers: number,
    options?: RecyclingWorkerPoolOptions,
  ) {
    invariant(maxWorkers > 0, "maxWorkers must be a positive number.");
    this.url = url;
    this.maxWorkerHeapBytes =
      options?.maxWorkerHeapBytes ?? MAX_WORKER_HEAP_BYTES_DEFAULT;
    this.slots = Array.from({ length: maxWorkers }, () => ({
      pool: createPool(url),
      tasksSinceSpawn: 0,
      inflight: 0,
      draining: false,
      probing: false,
      lastHeapBytes: undefined,
    }));
  }

  exec<T extends (...args: any[]) => any>(
    method: string | T,
    params?: Parameters<T> | null,
    options?: ExecOptions,
  ): WorkerpoolPromise<ReturnType<T>> {
    const slot = this.pickSlot();
    slot.inflight++;
    try {
      return (
        slot.pool
          .exec(method, params, options)
          // `finally` doesn't work, so use `then()` and `catch()` to ensure that `onSettled()` is invoked.
          .then((value) => {
            this.onSettled(slot);
            return value;
          })
          .catch((e) => {
            this.onSettled(slot);
            throw e;
          })
      );
    } catch (e) {
      this.onSettled(slot);
      throw e;
    }
  }

  /**
   * Pre-initializes WASM on the workers so that upcoming tasks don't pay
   * the initialization latency. Warms a single worker and resolves once it
   * is ready; the rest warm in the background. Correctness doesn't depend
   * on warm workers (every task awaits WASM internally), and a slot whose
   * warm-up fails surfaces the error on its next real task — the same
   * policy as a recycled slot. Rejects only when every worker fails to
   * warm, which signals a broken worker setup.
   */
  warmUp(): Promise<void> {
    // Warming every slot at once would fetch and compile the worker WASM N
    // times concurrently, competing over the same HTTP/2 connection with
    // the main-thread WASM and other startup fetches. The first warm-up
    // populates the HTTP cache, so the background ones load from cache.
    const [first, ...rest] = this.slots;
    return this.warmSlot(first).then(
      () => {
        for (const slot of rest) {
          // Fire-and-forget; a failure surfaces on the slot's next real task.
          this.warmSlot(slot).catch(() => undefined);
        }
      },
      (e) => {
        // A single failed spawn doesn't prove the setup is broken; fall
        // back to the remaining workers and reject only when all fail.
        if (rest.length === 0) throw e;
        return Promise.any(rest.map((slot) => this.warmSlot(slot))).then(
          () => undefined,
        );
      },
    );
  }

  /**
   * Whether at least one worker is still under its heap budget. When false,
   * every slot is draining and upstream intake should pause until a recycled
   * worker comes back (tasks dispatched anyway still run, on the
   * least-loaded draining slot).
   */
  canAcceptTasks(): boolean {
    return this.slots.some((slot) => !slot.draining);
  }

  stats(): WorkerPoolStats {
    const aggregated = {
      totalWorkers: 0,
      busyWorkers: 0,
      idleWorkers: 0,
      pendingTasks: 0,
      activeTasks: 0,
      tasksSinceSpawn: 0,
    };
    for (const slot of this.slots) {
      const stats = slot.pool.stats();
      aggregated.totalWorkers += stats.totalWorkers;
      aggregated.busyWorkers += stats.busyWorkers;
      aggregated.idleWorkers += stats.idleWorkers;
      aggregated.pendingTasks += stats.pendingTasks;
      aggregated.activeTasks += stats.activeTasks;
      aggregated.tasksSinceSpawn += slot.tasksSinceSpawn;
    }
    return aggregated;
  }

  /**
   * Aggregated WASM heap sizes from the most recent probes. Values are
   * point-in-time samples taken after task settlements (or {@link probeHeap});
   * under load they lag by the tasks queued ahead of the probe.
   */
  heapStats(): WorkerPoolHeapStats {
    const perSlot = this.slots.map((slot) => slot.lastHeapBytes);
    return {
      perSlot,
      totalBytes: perSlot.reduce<number>((sum, b) => sum + (b ?? 0), 0),
      maxWorkerHeapBytes: this.maxWorkerHeapBytes,
    };
  }

  /**
   * Requests a fresh heap probe on every non-draining slot (draining slots
   * are about to be recycled anyway). Probes coalesce per slot, so calling
   * this at display frequency is safe.
   */
  probeHeap(): void {
    if (this.terminated) return;
    for (const slot of this.slots) {
      if (!slot.draining) {
        this.probeSlot(slot);
      }
    }
  }

  terminate(): void {
    if (this.idleSweepTimer !== undefined) {
      clearTimeout(this.idleSweepTimer);
      this.idleSweepTimer = undefined;
    }
    this.terminated = true;
    for (const slot of this.slots) {
      slot.pool.terminate();
    }
  }

  private pickSlot(): Slot {
    // Prefer slots still under their heap budget; fall back to a draining
    // slot only when every slot is draining at once (it recycles once it
    // finally drains, so this cannot starve the recycling).
    const candidates = this.slots.filter((slot) => !slot.draining);
    const eligible = candidates.length > 0 ? candidates : this.slots;
    return eligible.reduce((least, slot) =>
      slot.inflight < least.inflight ? slot : least,
    );
  }

  private onSettled(slot: Slot): void {
    slot.inflight--;
    if (this.terminated) return;
    slot.tasksSinceSpawn++;
    if (slot.tasksSinceSpawn >= RECYCLE_AFTER_TASKS_BACKSTOP) {
      slot.draining = true;
    }
    // Terminating the worker must not kill in-flight tasks, so a slot over
    // its budget stops receiving tasks (pickSlot skips it) and recycles at
    // its next task boundary instead of immediately.
    if (slot.draining && slot.inflight === 0) {
      this.recycleSlot(slot);
    } else if (!slot.draining) {
      this.probeSlot(slot);
    }
    this.armIdleSweep();
  }

  private recycleSlot(slot: Slot): void {
    slot.pool.terminate();
    slot.pool = createPool(this.url);
    slot.tasksSinceSpawn = 0;
    slot.draining = false;
    slot.lastHeapBytes = undefined;
    // Fire-and-forget; a warm-up failure surfaces on the next real task.
    this.warmSlot(slot).catch(() => undefined);
  }

  // Warm-ups and probes are internal traffic: they count into `inflight` (to
  // steer dispatch away from a busy worker) but not into `tasksSinceSpawn`,
  // and their settlement doesn't re-arm the idle sweep, so a sweep can't
  // perpetuate itself through the work it triggers.

  private warmSlot(slot: Slot): Promise<void> {
    slot.inflight++;
    const settle = () => {
      slot.inflight--;
      // Same as the probe: if the slot drained while this warm-up was in
      // flight, its settlement is the last task boundary, so recycle here.
      if (!this.terminated && slot.draining && slot.inflight === 0) {
        this.recycleSlot(slot);
      }
    };
    // Wrapped in a native promise so that a synchronous exec failure rejects
    // instead of throwing through the recycle path.
    return new Promise((resolve, reject) => {
      try {
        slot.pool
          .exec("warmUp")
          .then(() => {
            settle();
            resolve();
          })
          .catch((e) => {
            settle();
            reject(e);
          });
      } catch (e) {
        settle();
        reject(e);
      }
    });
  }

  // The heap probe is the recycle trigger: after each settled task the
  // worker reports its actual linear memory size, which task-count or
  // input-size heuristics could only approximate. A probe rides the slot's
  // queue, so under load the measurement lags by the tasks queued ahead of
  // it — acceptable since upstream backpressure keeps queues shallow.
  private probeSlot(slot: Slot): void {
    if (slot.probing) return;
    slot.probing = true;
    slot.inflight++;
    const settle = (overBudget: boolean) => {
      slot.probing = false;
      slot.inflight--;
      if (this.terminated) return;
      if (overBudget) {
        slot.draining = true;
      }
      // Also covers a slot drained by the backstop while this probe was in
      // flight: the probe is then the last thing keeping the slot alive, so
      // its settlement must trigger the recycle even when under budget.
      if (slot.draining && slot.inflight === 0) {
        this.recycleSlot(slot);
      }
    };
    try {
      slot.pool
        .exec("getWasmMemoryUsage")
        .then((bytes) => {
          if (typeof bytes === "number") {
            slot.lastHeapBytes = bytes;
          }
          settle(typeof bytes === "number" && bytes >= this.maxWorkerHeapBytes);
        })
        .catch(() => {
          // A worker that cannot even report its heap is recycled conservatively.
          settle(true);
        });
    } catch {
      settle(true);
    }
  }

  private armIdleSweep(): void {
    // Re-armed on every settled task, so it fires RECYCLE_IDLE_MS after the
    // last one settles; slots that are still busy at that point are swept
    // when their remaining work settles and re-arms it.
    if (this.idleSweepTimer !== undefined) clearTimeout(this.idleSweepTimer);
    this.idleSweepTimer = setTimeout(() => {
      this.idleSweepTimer = undefined;
      for (const slot of this.slots) {
        if (slot.tasksSinceSpawn > 0 && slot.inflight === 0) {
          this.recycleSlot(slot);
        }
      }
    }, RECYCLE_IDLE_MS);
  }
}
