import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultConcurrencyManager } from "./concurrency";

// Importing the package reads os.cpus() (workerpool), which is unavailable
// in the test environment.
vi.mock("@navaramap/worker", () => ({
  createConcurrencyManager: (total: number) => ({ total }),
}));

const stubHardwareConcurrency = (hardwareConcurrency: number) => {
  vi.stubGlobal("navigator", { hardwareConcurrency });
};

describe("createDefaultConcurrencyManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to hardwareConcurrency on desktop and 2 on mobile", () => {
    stubHardwareConcurrency(12);
    expect(createDefaultConcurrencyManager(false).total).toBe(12);
    expect(createDefaultConcurrencyManager(true).total).toBe(2);
  });

  it("uses the requested pool size", () => {
    stubHardwareConcurrency(12);
    expect(createDefaultConcurrencyManager(false, 6).total).toBe(6);
    expect(createDefaultConcurrencyManager(true, 4).total).toBe(4);
  });

  it("clamps the pool size to [1, hardwareConcurrency]", () => {
    stubHardwareConcurrency(8);
    expect(createDefaultConcurrencyManager(false, 32).total).toBe(8);
    expect(createDefaultConcurrencyManager(false, Infinity).total).toBe(8);
    expect(createDefaultConcurrencyManager(false, 0).total).toBe(1);
    expect(createDefaultConcurrencyManager(false, -3).total).toBe(1);
    expect(createDefaultConcurrencyManager(false, NaN).total).toBe(1);
    expect(createDefaultConcurrencyManager(false, 3.7).total).toBe(3);
  });
});
