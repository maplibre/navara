import { describe, expect, it, vi } from "vitest";

import type { EventContext } from "./context";
import { processVectorDrapeChanged } from "./tile";

// The package barrel pulled in by tile.ts initializes a worker pool at module
// load (os.cpus()), which is unavailable in the test environment. Stub it.
vi.mock("@navaramap/worker", () => ({
  acquireWorkerPool: vi.fn(() => ({
    manager: { total: 1 },
    created: true,
    release: vi.fn(),
  })),
}));

describe("processVectorDrapeChanged", () => {
  it("marks only the listed terrain tiles", () => {
    const listed = { markVectorDrapeSourcesChanged: vi.fn() };
    const other = { markVectorDrapeSourcesChanged: vi.fn() };
    const ctx = {
      tileMapByHandle: new Map([
        [1n, listed],
        [2n, other],
      ]),
    } as unknown as EventContext;

    // Handle 3 has no tile mesh yet; it reads its sources on its first render.
    processVectorDrapeChanged(ctx, new BigUint64Array([1n, 3n]));

    expect(listed.markVectorDrapeSourcesChanged).toHaveBeenCalledTimes(1);
    expect(other.markVectorDrapeSourcesChanged).not.toHaveBeenCalled();
  });
});
