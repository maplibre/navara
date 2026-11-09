import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createConcurrencyManager, type ConcurrencyManager } from "./manager";
import {
  acquireWorkerPool as acquireWorkerPoolRaw,
  warmUpWorkerPool,
  workerPoolHolders,
  type WorkerPoolLease,
} from "./pool";
import type { RecyclingWorkerPoolOptions } from "./recyclingPool";

const { created, terminated } = vi.hoisted(() => ({
  created: { count: 0 },
  terminated: { count: 0 },
}));

vi.mock("./recyclingPool", () => ({
  RecyclingWorkerPool: class {
    constructor() {
      created.count++;
    }
    setReservedSlots() {}
    warmUp() {
      return Promise.resolve();
    }
    terminate() {
      terminated.count++;
    }
  },
}));

// Every lease a test takes, released after it so a failed assertion cannot
// leave the module-level pool alive for the next test.
const leases: WorkerPoolLease[] = [];
function acquireWorkerPool(
  url: string,
  manager: ConcurrencyManager,
  options?: RecyclingWorkerPoolOptions,
) {
  const lease = acquireWorkerPoolRaw(url, manager, options);
  leases.push(lease);
  return lease;
}

beforeEach(() => {
  created.count = 0;
  terminated.count = 0;
});

afterEach(() => {
  for (const lease of leases.splice(0)) lease.release();
  vi.restoreAllMocks();
});

it("shares one pool and its manager between holders", () => {
  const first = createConcurrencyManager(4);
  const a = acquireWorkerPool("https://example.com", first);
  const b = acquireWorkerPool(
    "https://example.com",
    createConcurrencyManager(2),
  );

  expect(created.count).toBe(1);
  expect(a.manager).toBe(first);
  expect(b.manager).toBe(first);

  a.release();
  b.release();
});

it("terminates the pool only when the last holder releases", () => {
  const a = acquireWorkerPool(
    "https://example.com",
    createConcurrencyManager(1),
  );
  const b = acquireWorkerPool(
    "https://example.com",
    createConcurrencyManager(1),
  );

  a.release();
  expect(terminated.count).toBe(0);
  expect(() => warmUpWorkerPool()).not.toThrow();

  b.release();
  expect(terminated.count).toBe(1);
  expect(() => warmUpWorkerPool()).toThrow();
});

it("ignores a repeated release so it cannot drop another holder's claim", () => {
  const a = acquireWorkerPool(
    "https://example.com",
    createConcurrencyManager(1),
  );
  const b = acquireWorkerPool(
    "https://example.com",
    createConcurrencyManager(1),
  );

  a.release();
  a.release();
  expect(terminated.count).toBe(0);

  b.release();
  expect(terminated.count).toBe(1);
});

it("creates a fresh pool after every holder released", () => {
  acquireWorkerPool(
    "https://example.com",
    createConcurrencyManager(1),
  ).release();
  const next = createConcurrencyManager(3);
  const lease = acquireWorkerPool("https://example.com", next);

  expect(created.count).toBe(2);
  expect(lease.manager).toBe(next);

  lease.release();
});

it("tells only the creating claim that it created the pool", () => {
  const a = acquireWorkerPool(
    "https://example.com",
    createConcurrencyManager(1),
  );
  const b = acquireWorkerPool(
    "https://example.com",
    createConcurrencyManager(1),
  );

  expect(a.created).toBe(true);
  expect(b.created).toBe(false);
  expect(workerPoolHolders()).toBe(2);
});

it("warns when a later claim asks for different pool settings", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  acquireWorkerPool("https://example.com", createConcurrencyManager(4), {
    maxWorkerHeapBytes: 256,
  });

  acquireWorkerPool("https://example.com", createConcurrencyManager(4), {
    maxWorkerHeapBytes: 256,
  });
  expect(warn).not.toHaveBeenCalled();

  acquireWorkerPool("https://example.com", createConcurrencyManager(2), {
    maxWorkerHeapBytes: 128,
  });
  expect(warn).toHaveBeenCalledOnce();
});
