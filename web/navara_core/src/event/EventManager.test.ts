import type { RenderableFeatureAddedEvent } from "@navaramap/engine";
import { expect, it, vi } from "vitest";

import { wait } from "../time";

import { EventManager } from "./EventManager";
import { makeEvent, makeRenderableFeatures } from "./mock";

it("should handle renderable feature event", async () => {
  const eventManager = new EventManager();

  const mockFnAdded = vi.fn();
  const mockFnRemoved = vi.fn();
  const mockFnChanged = vi.fn();

  // First frame
  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 2),
        makeRenderableFeatures(1, 3),
        makeRenderableFeatures(1, 4),
      ],
      renderable_feature_removed: [],
      renderable_feature_changed: [],
    }),
  );

  eventManager.processTransactionEvents(
    "renderableFeature",
    {
      add: {
        key: "renderable_feature_added",
        max: 3,
      },
      remove: {
        key: "renderable_feature_removed",
      },
      change: {
        key: "renderable_feature_changed",
      },
    },
    async ({ type }) => {
      switch (type) {
        case "add":
          await wait(100);
          mockFnAdded();
          break;
        case "remove":
          await wait(100);
          mockFnRemoved();
          break;
        case "change":
          await wait(100);
          mockFnChanged();
          break;
      }
    },
  );

  await vi.waitFor(() => expect(mockFnAdded).toBeCalledTimes(3));
  expect(mockFnRemoved).not.toBeCalled();
  expect(mockFnChanged).not.toBeCalled();

  mockFnAdded.mockReset();

  // Second frame
  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: [],
      renderable_feature_removed: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 4),
      ],
      renderable_feature_changed: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 2),
        makeRenderableFeatures(1, 3),
      ],
    }),
  );

  eventManager.processTransactionEvents(
    "renderableFeature",
    {
      add: {
        key: "renderable_feature_added",
        max: 3,
      },
      remove: {
        key: "renderable_feature_removed",
      },
      change: {
        key: "renderable_feature_changed",
      },
    },
    async ({ type }) => {
      switch (type) {
        case "add":
          await wait(100);
          mockFnAdded();
          break;
        case "remove":
          await wait(100);
          mockFnRemoved();
          break;
        case "change":
          await wait(100);
          mockFnChanged();
          break;
      }
    },
  );

  expect(mockFnAdded).not.toBeCalled();
  await vi.waitFor(() => expect(mockFnRemoved).toBeCalledTimes(1));
  expect(mockFnChanged).not.toBeCalled();

  mockFnRemoved.mockReset();

  // Third frame
  eventManager.processTransactionEvents(
    "renderableFeature",
    {
      add: {
        key: "renderable_feature_added",
        max: 3,
      },
      remove: {
        key: "renderable_feature_removed",
      },
      change: {
        key: "renderable_feature_changed",
      },
    },
    async ({ type }) => {
      switch (type) {
        case "add":
          await wait(100);
          mockFnAdded();
          break;
        case "remove":
          await wait(100);
          mockFnRemoved();
          break;
        case "change":
          await wait(100);
          mockFnChanged();
          break;
      }
    },
  );

  expect(mockFnAdded).not.toBeCalled();
  expect(mockFnRemoved).not.toBeCalled();
  await vi.waitFor(() => expect(mockFnChanged).toBeCalledTimes(2));
});

it("should remove duplicated renderable feature event", async () => {
  const eventManager = new EventManager();

  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 2),
        makeRenderableFeatures(1, 3),
        makeRenderableFeatures(1, 4),
      ],
      renderable_feature_removed: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 3),
      ],
      renderable_feature_changed: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 4),
      ],
    }),
  );

  eventManager.removeDuplicatedTransactionEvents({
    add: {
      key: "renderable_feature_added",
    },
    remove: {
      key: "renderable_feature_removed",
    },
    change: {
      key: "renderable_feature_changed",
    },
  });

  expect(eventManager.stacks.renderable_feature_added).toEqual([
    makeRenderableFeatures(1, 2),
    makeRenderableFeatures(1, 4),
  ]);
  expect(eventManager.stacks.renderable_feature_removed).toEqual([]);
  expect(eventManager.stacks.renderable_feature_changed).toEqual([
    makeRenderableFeatures(1, 4),
  ]);
});

it("should handle the increment in async boundary", async () => {
  const eventManager = new EventManager();

  // Simulate a concurrency limiter that allows max 2 concurrent operations
  const maxConcurrent = 2;
  let currentConcurrent = 0;
  let processedCount = 0;

  const canIncrement = () => currentConcurrent < maxConcurrent;
  const increment = () => {
    currentConcurrent++;
  };
  const decrement = () => {
    currentConcurrent--;
  };

  const doAsync = async (t: number) => {
    increment();
    await wait(t);
    decrement();
    processedCount++;
  };

  const addedFeatures: RenderableFeatureAddedEvent[] = [
    makeRenderableFeatures(1, 1),
    makeRenderableFeatures(1, 2),
    makeRenderableFeatures(1, 3),
    makeRenderableFeatures(1, 4),
    makeRenderableFeatures(1, 5),
  ];

  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: addedFeatures,
      renderable_feature_removed: [],
      renderable_feature_changed: [],
    }),
  );

  const waitingTime = 10;

  eventManager.processTransactionEvents(
    "renderableFeature",
    {
      add: {
        key: "renderable_feature_added",
        max: 10,
      },
      remove: {
        key: "renderable_feature_removed",
      },
      change: {
        key: "renderable_feature_changed",
      },
    },
    async ({ type }) => {
      if (type === "add") {
        await doAsync(waitingTime);
      }
    },
    {
      shouldProcess: ({ type }) => {
        if (type === "add") {
          return canIncrement();
        }
        return true;
      },
    },
  );

  // Wait until all features is processed.
  await wait(waitingTime * (addedFeatures.length + 1));

  await vi.waitFor(() => expect(processedCount).toBe(2));
});

it("should keep skipped events in stack when shouldProcess returns false", async () => {
  const eventManager = new EventManager();

  const processedIds: number[] = [];

  // Add 5 events to the stack
  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 2),
        makeRenderableFeatures(1, 3),
        makeRenderableFeatures(1, 4),
        makeRenderableFeatures(1, 5),
      ],
      renderable_feature_removed: [],
      renderable_feature_changed: [],
    }),
  );

  // First pass: only process events with odd gen (1, 3, 5)
  await eventManager.forEachStackAsync(
    "renderable_feature_added",
    async (event) => {
      processedIds.push(event.gen);
    },
    10,
    (event) => event.gen % 2 === 1, // Only process odd gen
  );

  // Should have processed 1, 3, 5
  expect(processedIds).toEqual([1, 3, 5]);

  // Events with gen 2, 4 should remain in the stack
  expect(eventManager.stacks.renderable_feature_added).toHaveLength(2);
  expect(eventManager.stacks.renderable_feature_added[0]).toMatchObject({
    gen: 2,
  });
  expect(eventManager.stacks.renderable_feature_added[1]).toMatchObject({
    gen: 4,
  });

  // Second pass: process remaining events
  processedIds.length = 0;
  await eventManager.forEachStackAsync(
    "renderable_feature_added",
    async (event) => {
      processedIds.push(event.gen);
    },
    10,
  );

  // Should have processed 2, 4
  expect(processedIds).toEqual([2, 4]);

  // Stack should now be empty
  expect(eventManager.stacks.renderable_feature_added).toHaveLength(0);
});

it("should correctly count max limit including skipped events", async () => {
  const eventManager = new EventManager();

  const processedIds: number[] = [];

  // Add 10 events to the stack
  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 2),
        makeRenderableFeatures(1, 3),
        makeRenderableFeatures(1, 4),
        makeRenderableFeatures(1, 5),
        makeRenderableFeatures(1, 6),
        makeRenderableFeatures(1, 7),
        makeRenderableFeatures(1, 8),
        makeRenderableFeatures(1, 9),
        makeRenderableFeatures(1, 10),
      ],
      renderable_feature_removed: [],
      renderable_feature_changed: [],
    }),
  );

  // Process with max=5, but only process odd gen (1, 3, 5)
  // This tests that idx is incremented for skipped events too,
  // so max limit works correctly (should check first 5 events: 1,2,3,4,5)
  await eventManager.forEachStackAsync(
    "renderable_feature_added",
    async (event) => {
      processedIds.push(event.gen);
    },
    5, // max limit
    (event) => event.gen % 2 === 1, // Only process odd gen
  );

  // Should have processed odd events within first 5: 1, 3, 5
  expect(processedIds).toEqual([1, 3, 5]);

  // Stack should have: 2, 4 (skipped from first 5) + 6, 7, 8, 9, 10 (not checked)
  expect(eventManager.stacks.renderable_feature_added).toHaveLength(7);
  expect(
    eventManager.stacks.renderable_feature_added.map((e) => e.gen),
  ).toEqual([2, 4, 6, 7, 8, 9, 10]);
});

it("should process the remaining events of a batch when one handler rejects", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const eventManager = new EventManager();

  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 2),
        makeRenderableFeatures(1, 3),
      ],
    }),
  );

  const processedIds: number[] = [];
  await eventManager.forEachStackAsync(
    "renderable_feature_added",
    async (event) => {
      if (event.gen === 2) throw new Error("boom");
      processedIds.push(event.gen);
    },
    10,
  );

  expect(processedIds).toEqual([1, 3]);
  // The failed event still counts as processed: it must leave the stack (and
  // be freed) instead of being retried forever.
  expect(eventManager.stacks.renderable_feature_added).toHaveLength(0);
  expect(consoleError).toHaveBeenCalledTimes(1);
  consoleError.mockRestore();
});

it("should abort the remaining in-flight adds even when an onAbort handler throws", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const eventManager = new EventManager();

  const aborted: number[] = [];
  let releaseAdds!: () => void;
  const gate = new Promise<void>((resolve) => (releaseAdds = resolve));

  const options = {
    add: { key: "renderable_feature_added" },
    remove: { key: "renderable_feature_removed" },
  } as const;
  const cb = async ({ type }: { type: string }) => {
    if (type === "add") await gate;
  };
  const handlers = {
    onAbort: (ev: { gen: number }) => {
      if (ev.gen === 1) throw new Error("abort boom");
      aborted.push(ev.gen);
    },
  };

  // First frame: two adds start and stay pending on the gate.
  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 2),
      ],
    }),
  );
  eventManager.processTransactionEvents("workerTask", options, cb, handlers);

  // Second frame: removals for both pending adds arrive. The first abort
  // handler throws; the second must still run.
  eventManager.pushEvents(
    makeEvent({
      renderable_feature_removed: [
        makeRenderableFeatures(1, 1),
        makeRenderableFeatures(1, 2),
      ],
    }),
  );
  eventManager.processTransactionEvents("workerTask", options, cb, handlers);

  expect(aborted).toEqual([2]);
  expect(consoleError).toHaveBeenCalledTimes(1);

  // Later frames replay the transaction; the pending adds settle and the
  // remove phase drains the stack.
  releaseAdds();
  await vi.waitFor(() => {
    eventManager.processTransactionEvents("workerTask", options, cb, handlers);
    expect(eventManager.stacks.renderable_feature_removed).toHaveLength(0);
  });
  consoleError.mockRestore();
});

it("should keep in-flight add tracking isolated between transaction keys", async () => {
  const eventManager = new EventManager();

  const aborted: number[] = [];
  let releaseAdds!: () => void;
  const gate = new Promise<void>((resolve) => (releaseAdds = resolve));

  const optionsA = {
    add: { key: "renderable_feature_added" },
    remove: { key: "renderable_feature_removed" },
  } as const;
  const cbA = async ({ type }: { type: string }) => {
    if (type === "add") await gate;
  };
  const handlersA = {
    onAbort: (ev: { gen: number }) => {
      aborted.push(ev.gen);
    },
  };

  // Key A: one add starts and stays pending on the gate.
  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: [makeRenderableFeatures(1, 1)],
    }),
  );
  eventManager.processTransactionEvents("keyA", optionsA, cbA, handlersA);

  // Key B: runs its add and remove phases to completion, clearing ITS OWN
  // in-flight tracking. Before the per-key split this wiped key A's ids too
  // and A's abort below never fired.
  let processedB = false;
  eventManager.pushEvents(
    makeEvent({
      texture_fragment_removed: [makeRenderableFeatures(9, 9)],
    }),
  );
  const optionsB = {
    add: { key: "texture_fragment_requested" },
    remove: { key: "texture_fragment_removed" },
  } as const;
  const cbB = async ({ type }: { type: string }) => {
    if (type === "remove") processedB = true;
  };
  // Replay across "frames" until key B's remove phase (which clears its
  // tracking) has run.
  await vi.waitFor(() => {
    eventManager.processTransactionEvents("keyB", optionsB, cbB, {
      onAbort: () => {},
    });
    expect(processedB).toBe(true);
  });

  // A removal for key A's still-pending add arrives; its abort must fire.
  eventManager.pushEvents(
    makeEvent({
      renderable_feature_removed: [makeRenderableFeatures(1, 1)],
    }),
  );
  eventManager.processTransactionEvents("keyA", optionsA, cbA, handlersA);

  expect(aborted).toEqual([1]);
  releaseAdds();
});

it("should dispatch the pending stack in the given order across passes", async () => {
  const eventManager = new EventManager();
  const processedIds: number[] = [];

  // gen doubles as the urgency rank here: lower is more urgent.
  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: [
        makeRenderableFeatures(1, 3),
        makeRenderableFeatures(1, 2),
      ],
      renderable_feature_removed: [],
      renderable_feature_changed: [],
    }),
  );
  const byUrgency = (
    a: RenderableFeatureAddedEvent,
    b: RenderableFeatureAddedEvent,
  ) => a.gen - b.gen;

  // Only one slot free: the more urgent of the two goes first even though it
  // was pushed second.
  let slots = 1;
  await eventManager.forEachStackAsync(
    "renderable_feature_added",
    async (event) => {
      processedIds.push(event.gen);
    },
    10,
    () => slots-- > 0,
    byUrgency,
  );
  expect(processedIds).toEqual([2]);

  // A more urgent event arriving later overtakes the one left behind.
  eventManager.pushEvents(
    makeEvent({
      renderable_feature_added: [makeRenderableFeatures(1, 1)],
      renderable_feature_removed: [],
      renderable_feature_changed: [],
    }),
  );
  slots = 1;
  await eventManager.forEachStackAsync(
    "renderable_feature_added",
    async (event) => {
      processedIds.push(event.gen);
    },
    10,
    () => slots-- > 0,
    byUrgency,
  );
  expect(processedIds).toEqual([2, 1]);
  expect(eventManager.stacks.renderable_feature_added).toHaveLength(1);
});

it("should merge newly pushed events into the already ordered stack", async () => {
  const eventManager = new EventManager();
  const processed: number[] = [];
  const byUrgency = (
    a: RenderableFeatureAddedEvent,
    b: RenderableFeatureAddedEvent,
  ) => a.gen - b.gen;
  const push = (...gens: number[]) =>
    eventManager.pushEvents(
      makeEvent({
        renderable_feature_added: gens.map((g) => makeRenderableFeatures(1, g)),
        renderable_feature_removed: [],
        renderable_feature_changed: [],
      }),
    );
  const pass = async (slots: number) => {
    let left = slots;
    await eventManager.forEachStackAsync(
      "renderable_feature_added",
      async (event) => {
        processed.push(event.gen);
      },
      10,
      () => left-- > 0,
      byUrgency,
    );
  };

  // Each pass leaves a sorted prefix behind; removals from it and later
  // pushes after it must keep the dispatch order correct across passes.
  push(5, 3, 8);
  await pass(1);
  push(4, 1);
  await pass(2);
  push(6, 2);
  await pass(10);
  expect(processed).toEqual([3, 1, 4, 2, 5, 6, 8]);
  expect(eventManager.stacks.renderable_feature_added).toHaveLength(0);
});
