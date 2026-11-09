import { afterEach, beforeEach, expect, it, vi } from "vitest";
import workerpool from "workerpool";
import type Pool from "workerpool/types/Pool";

import {
  RECYCLE_AFTER_TASKS_BACKSTOP,
  RECYCLE_IDLE_MS,
  RecyclingWorkerPool,
} from "./recyclingPool";

type MockExecution = {
  method: string;
  settled: boolean;
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
};

type MockPool = {
  executions: MockExecution[];
  /** Busy / queued counts the worker reports, independent of the slot's
   * own `inflight` (e.g. a cancelled task still running). */
  activeTasks: number;
  pendingTasks: number;
  exec: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  stats: () => ReturnType<Pool["stats"]>;
};

// Every workerpool.pool() call yields a fresh mock, recorded in order so
// tests can distinguish original slot pools from recycled replacements.
let pools: MockPool[] = [];

vi.spyOn(workerpool, "pool").mockImplementation(() => {
  const mock: MockPool = {
    executions: [],
    activeTasks: 0,
    pendingTasks: 0,
    exec: vi.fn(
      (method: string) =>
        new workerpool.Promise(
          (
            resolve: (value?: unknown) => void,
            reject: (e?: unknown) => void,
          ) => {
            const execution: MockExecution = {
              method,
              settled: false,
              resolve: (value?: unknown) => {
                execution.settled = true;
                resolve(value);
              },
              reject: (e?: unknown) => {
                execution.settled = true;
                reject(e);
              },
            };
            mock.executions.push(execution);
          },
        ),
    ),
    terminate: vi.fn(),
    stats: () => ({
      totalWorkers: 1,
      busyWorkers: 0,
      idleWorkers: 1,
      pendingTasks: mock.pendingTasks,
      activeTasks: mock.activeTasks,
    }),
  };
  pools.push(mock);
  return mock as unknown as Pool;
});

beforeEach(() => {
  pools = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const PROBE = "getWasmMemoryUsage";

const nextPending = (pool: MockPool, method: string) =>
  pool.executions.find((e) => e.method === method && !e.settled);

/** Settles the oldest pending "test" task. */
const settleTask = (pool: MockPool) => {
  nextPending(pool, "test")?.resolve();
};

/** Answers the pending heap probe with the given byte count. */
const respondToProbe = (pool: MockPool, bytes: number) => {
  nextPending(pool, PROBE)?.resolve(bytes);
};

it("creates one single-worker pool per slot", () => {
  new RecyclingWorkerPool("https://example.com", 3);
  expect(pools).toHaveLength(3);
  expect(workerpool.pool).toHaveBeenLastCalledWith(
    "https://example.com",
    expect.objectContaining({
      maxWorkers: 1,
      minWorkers: 0,
      // Must outlive the longest synchronous WASM task, or a cancel while
      // running force-terminates the warm worker despite the worker-side
      // abort listener (workerpool's default is 1s).
      workerTerminateTimeout: expect.any(Number),
    }),
  );
});

it("dispatches tasks to the least-loaded slot", () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);

  pool.exec("test");
  pool.exec("test");

  expect(pools[0].exec).toHaveBeenCalledTimes(1);
  expect(pools[1].exec).toHaveBeenCalledTimes(1);
});

it("does not dispatch to a worker still running a cancelled task", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);

  const cancelled = pool.exec("test");
  cancelled.cancel();
  await cancelled.catch(() => undefined);
  respondToProbe(pools[0], 0);
  // The slot's own count is back to 0, but its worker is still busy.
  pools[0].activeTasks = 1;

  pool.exec("test");
  const tests = (p: MockPool) =>
    p.executions.filter((e) => e.method === "test").length;
  expect(tests(pools[0])).toBe(1);
  expect(tests(pools[1])).toBe(1);
});

it("sums the slots' load, counting a cancelled task still running", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);
  expect(pool.load()).toBe(0);

  const cancelled = pool.exec("test");
  pool.exec("test");
  expect(pool.load()).toBe(2);

  cancelled.cancel();
  await cancelled.catch(() => undefined);
  respondToProbe(pools[0], 0);
  expect(pool.load()).toBe(1);
  // Its worker is still running it.
  pools[0].activeTasks = 1;
  expect(pool.load()).toBe(2);
});

it("leaves the pool's own probes out of its load", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 1);

  pool.exec("test");
  settleTask(pools[0]);
  await vi.advanceTimersByTimeAsync(0);
  expect(nextPending(pools[0], PROBE)).toBeDefined();
  expect(pool.load()).toBe(0);
});

it("keeps reserved slots free of new tasks, leaving one slot open", () => {
  const pool = new RecyclingWorkerPool("https://example.com", 3);
  const tests = (p: MockPool) =>
    p.executions.filter((e) => e.method === "test").length;

  // Slot 0 is busy, so the idle slots are the ones reserved.
  pool.exec("test");
  pool.setReservedSlots(2);
  expect(pool.reservedSlots()).toBe(2);
  pool.exec("test");
  pool.exec("test");
  expect(tests(pools[0])).toBe(3);
  expect(tests(pools[1])).toBe(0);
  expect(tests(pools[2])).toBe(0);

  pool.setReservedSlots(5);
  expect(pool.reservedSlots()).toBe(2);

  pool.setReservedSlots(0);
  expect(pool.reservedSlots()).toBe(0);
  pool.exec("test");
  expect(tests(pools[1]) + tests(pools[2])).toBe(1);
});

it("reports no capacity while every unreserved slot is draining", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2, {
    maxWorkerHeapBytes: 100,
  });
  pool.exec("test");
  pool.setReservedSlots(1);
  expect(pool.canAcceptTasks()).toBe(true);

  // The open slot goes over budget while its next task still runs.
  pool.exec("test");
  settleTask(pools[0]);
  await vi.advanceTimersByTimeAsync(0);
  respondToProbe(pools[0], 200);
  await vi.advanceTimersByTimeAsync(0);
  expect(pool.canAcceptTasks()).toBe(false);
});

it("probes heap usage after a settled task and recycles once over budget", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 1, {
    maxWorkerHeapBytes: 100,
  });

  const task = pool.exec("test");
  settleTask(pools[0]);
  await task;
  expect(nextPending(pools[0], PROBE)).toBeDefined();

  // Under budget: the slot keeps its worker.
  respondToProbe(pools[0], 99);
  expect(pools[0].terminate).not.toHaveBeenCalled();

  // Over budget: the slot recycles and pre-warms the replacement.
  const task2 = pool.exec("test");
  settleTask(pools[0]);
  await task2;
  respondToProbe(pools[0], 100);
  expect(pools[0].terminate).toHaveBeenCalledTimes(1);
  expect(pools).toHaveLength(2);
  expect(pools[1].executions[0]?.method).toBe("warmUp");
});

it("coalesces heap probes", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 1);

  const task1 = pool.exec("test");
  const task2 = pool.exec("test");
  settleTask(pools[0]);
  await task1;
  settleTask(pools[0]);
  await task2;

  expect(pools[0].executions.filter((e) => e.method === PROBE)).toHaveLength(1);
});

it("recycles conservatively when the heap probe fails", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 1);

  const task = pool.exec("test");
  settleTask(pools[0]);
  await task;

  nextPending(pools[0], PROBE)?.reject(new Error("worker died"));
  expect(pools[0].terminate).toHaveBeenCalledTimes(1);
  expect(pools[1].executions[0]?.method).toBe("warmUp");
});

it("stops dispatching to a draining slot until it recycles", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2, {
    maxWorkerHeapBytes: 100,
  });

  // Two overlapping tasks on the first slot (plus one pinned on the second
  // so in-flight ties keep resolving to the first).
  const first = pool.exec("test");
  pool.exec("test");
  const second = pool.exec("test");

  // Settling one task triggers a probe reporting over budget; the remaining
  // task keeps the slot from recycling immediately.
  settleTask(pools[0]);
  await first;
  respondToProbe(pools[0], 100);
  expect(pools[0].terminate).not.toHaveBeenCalled();

  // The draining slot must not receive new tasks even though it ties the
  // other slot on in-flight count.
  pool.exec("test");
  expect(pools[1].exec).toHaveBeenCalledTimes(2);

  // Once the remaining task settles, the slot recycles and gets warmed.
  settleTask(pools[0]);
  await second;
  expect(pools[0].terminate).toHaveBeenCalledTimes(1);
  expect(pools[2].executions[0]?.method).toBe("warmUp");
});

it("recycles after the task-count backstop even when probes stay under budget", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 1);

  for (let i = 0; i < RECYCLE_AFTER_TASKS_BACKSTOP; i++) {
    const task = pool.exec("test");
    settleTask(pools[0]);
    await task;
    respondToProbe(pools[0], 1);
  }

  expect(pools[0].terminate).toHaveBeenCalledTimes(1);
  expect(pools[1].executions[0]?.method).toBe("warmUp");
});

it("recycles once a late probe settles on a slot drained by the backstop", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 1);

  // The probe from the first settle stays pending for the whole loop, so
  // when the backstop drains the slot, the probe is the only in-flight work.
  for (let i = 0; i < RECYCLE_AFTER_TASKS_BACKSTOP; i++) {
    const task = pool.exec("test");
    settleTask(pools[0]);
    await task;
  }
  expect(pools[0].terminate).not.toHaveBeenCalled();

  // Even an under-budget probe result must trigger the deferred recycle.
  respondToProbe(pools[0], 1);
  expect(pools[0].terminate).toHaveBeenCalledTimes(1);
  expect(pools[1].executions[0]?.method).toBe("warmUp");
});

it("recycles used slots after the pool goes idle", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);

  const task = pool.exec("test");
  settleTask(pools[0]);
  await task;
  respondToProbe(pools[0], 1);

  vi.advanceTimersByTime(RECYCLE_IDLE_MS);

  // Only the used slot is recycled; the untouched slot keeps its pool.
  expect(pools[0].terminate).toHaveBeenCalledTimes(1);
  expect(pools[1].terminate).not.toHaveBeenCalled();
  expect(pools[2].executions[0]?.method).toBe("warmUp");
  // The warm-up settlement must not re-arm the sweep against fresh slots.
  nextPending(pools[2], "warmUp")?.resolve();
  vi.advanceTimersByTime(RECYCLE_IDLE_MS);
  expect(pools[2].terminate).not.toHaveBeenCalled();
});

it("warmUp() warms a single worker first, then the rest in the background", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);

  const warmed = pool.warmUp();

  // Only one worker fetches WASM up front, keeping startup bandwidth free.
  expect(pools[0].executions[0]?.method).toBe("warmUp");
  expect(pools[1].executions).toHaveLength(0);

  nextPending(pools[0], "warmUp")?.resolve();
  await warmed;

  // The remaining slot warms in the background once the first is ready.
  expect(nextPending(pools[1], "warmUp")).toBeDefined();
});

it("warmUp() starts no background warm-up once terminated", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);

  const warmed = pool.warmUp();
  pool.terminate();
  nextPending(pools[0], "warmUp")?.resolve();
  await warmed;

  expect(pools[1].executions).toHaveLength(0);
});

it("warmUp() falls back to the remaining workers when the first fails", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);

  const warmed = pool.warmUp();

  nextPending(pools[0], "warmUp")?.reject(new Error("boom"));
  await vi.advanceTimersByTimeAsync(0);
  nextPending(pools[1], "warmUp")?.resolve();
  await warmed;
});

it("warmUp() rejects only when every worker fails to warm", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);

  const warmed = pool.warmUp();

  nextPending(pools[0], "warmUp")?.reject(new Error("boom0"));
  await vi.advanceTimersByTimeAsync(0);
  nextPending(pools[1], "warmUp")?.reject(new Error("boom1"));
  await expect(warmed).rejects.toBeInstanceOf(AggregateError);
});

it("warmUp() rejects with the original error for a single-worker pool", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 1);

  const warmed = pool.warmUp();

  nextPending(pools[0], "warmUp")?.reject(new Error("boom"));
  await expect(warmed).rejects.toThrow("boom");
});

it("reports no capacity while every slot is draining", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 1, {
    maxWorkerHeapBytes: 100,
  });
  expect(pool.canAcceptTasks()).toBe(true);

  const task1 = pool.exec("test");
  const task2 = pool.exec("test");
  settleTask(pools[0]);
  await task1;
  respondToProbe(pools[0], 100);
  expect(pool.canAcceptTasks()).toBe(false);

  // Recycling restores capacity.
  settleTask(pools[0]);
  await task2;
  expect(pool.canAcceptTasks()).toBe(true);
});

it("terminate() terminates all slots and cancels the idle sweep", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);

  const task = pool.exec("test");
  settleTask(pools[0]);
  await task;

  pool.terminate();
  expect(pools[0].terminate).toHaveBeenCalledTimes(1);
  expect(pools[1].terminate).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(RECYCLE_IDLE_MS);
  expect(pools).toHaveLength(2);
});

it("aggregates stats across slots", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);

  const task = pool.exec("test");
  settleTask(pools[0]);
  await task;

  expect(pool.stats()).toEqual({
    totalWorkers: 2,
    busyWorkers: 0,
    idleWorkers: 2,
    pendingTasks: 0,
    activeTasks: 0,
    tasksSinceSpawn: 1,
  });
});

it("stores probed heap bytes and aggregates them in heapStats()", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2, {
    maxWorkerHeapBytes: 1000,
  });

  expect(pool.heapStats()).toEqual({
    perSlot: [undefined, undefined],
    totalBytes: 0,
    maxWorkerHeapBytes: 1000,
  });

  // A settled task triggers a probe on its slot.
  const task = pool.exec("test");
  settleTask(pools[0]);
  await vi.advanceTimersByTimeAsync(0);
  respondToProbe(pools[0], 300);
  await vi.advanceTimersByTimeAsync(0);
  await task;

  const stats = pool.heapStats();
  expect(stats.perSlot[0]).toBe(300);
  expect(stats.totalBytes).toBe(300);
});

it("probeHeap() probes idle slots and coalesces with in-flight probes", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 2);

  pool.probeHeap();
  // Calling again while probes are in flight must not enqueue duplicates.
  pool.probeHeap();
  expect(pools[0].executions.filter((e) => e.method === PROBE)).toHaveLength(1);
  expect(pools[1].executions.filter((e) => e.method === PROBE)).toHaveLength(1);

  respondToProbe(pools[0], 111);
  respondToProbe(pools[1], 222);
  await vi.advanceTimersByTimeAsync(0);

  expect(pool.heapStats().totalBytes).toBe(333);
});

it("clears a slot's heap sample when it is recycled", async () => {
  const pool = new RecyclingWorkerPool("https://example.com", 1, {
    maxWorkerHeapBytes: 1000,
  });

  const task = pool.exec("test");
  settleTask(pools[0]);
  await vi.advanceTimersByTimeAsync(0);
  // Over budget: the probe both records the sample and drains the slot,
  // which recycles immediately (inflight is 0) — the sample must not
  // survive into the fresh worker.
  respondToProbe(pools[0], 2000);
  await vi.advanceTimersByTimeAsync(0);
  await task;

  expect(pool.heapStats().perSlot[0]).toBeUndefined();
  expect(pool.heapStats().totalBytes).toBe(0);
});
