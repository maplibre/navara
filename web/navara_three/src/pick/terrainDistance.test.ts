import { describe, expect, it, vi } from "vitest";

import {
  TERRAIN_DISTANCE_MAX_AGE_MS,
  TerrainDistanceCache,
} from "./terrainDistance";

function setup() {
  let now = 0;
  const pending: ((d: number | null) => void)[] = [];
  const pickSync = vi.fn(() => 100);
  const pickAsync = vi.fn(
    () => new Promise<number | null>((resolve) => pending.push(resolve)),
  );
  const cache = new TerrainDistanceCache(pickSync, pickAsync, () => now);
  return {
    cache,
    pickSync,
    pickAsync,
    advance: (ms: number) => {
      now += ms;
    },
    resolveAll: async (d: number | null) => {
      for (const r of pending.splice(0)) r(d);
      await Promise.resolve();
    },
  };
}

describe("TerrainDistanceCache", () => {
  it("samples synchronously on the first read", () => {
    const { cache, pickSync, pickAsync } = setup();
    expect(cache.get()).toBe(100);
    expect(pickSync).toHaveBeenCalledTimes(1);
    expect(pickAsync).not.toHaveBeenCalled();
  });

  it("serves a burst from the cache with one async refresh in flight", () => {
    const { cache, pickSync, pickAsync, advance } = setup();
    cache.get();
    for (let i = 0; i < 10; i++) {
      advance(5);
      expect(cache.get()).toBe(100);
    }
    expect(pickSync).toHaveBeenCalledTimes(1);
    expect(pickAsync).toHaveBeenCalledTimes(1);
  });

  it("adopts the async result and starts the next refresh", async () => {
    const { cache, pickAsync, advance, resolveAll } = setup();
    cache.get();
    advance(5);
    cache.get();
    await resolveAll(80);
    advance(5);
    expect(cache.get()).toBe(80);
    expect(pickAsync).toHaveBeenCalledTimes(2);
  });

  it("keeps serving the cache while a refresh outlives the age limit", () => {
    const { cache, pickSync, advance } = setup();
    cache.get();
    advance(5);
    cache.get();
    advance(TERRAIN_DISTANCE_MAX_AGE_MS);
    expect(cache.get()).toBe(100);
    expect(pickSync).toHaveBeenCalledTimes(1);
  });

  it("re-samples synchronously after the age limit with no refresh in flight", async () => {
    const { cache, pickSync, advance, resolveAll } = setup();
    cache.get();
    advance(5);
    cache.get();
    await resolveAll(80);
    pickSync.mockReturnValue(30);
    advance(TERRAIN_DISTANCE_MAX_AGE_MS + 1);
    expect(cache.get()).toBe(30);
    expect(pickSync).toHaveBeenCalledTimes(2);
  });

  it("recovers from a failed refresh", async () => {
    let now = 0;
    const pickSync = vi.fn(() => 100);
    const pickAsync = vi.fn(() => Promise.reject(new Error("disposed")));
    const cache = new TerrainDistanceCache(pickSync, pickAsync, () => now);
    cache.get();
    now += 5;
    cache.get();
    await Promise.resolve();
    await Promise.resolve();
    now += 5;
    cache.get();
    expect(pickAsync).toHaveBeenCalledTimes(2);
  });
});
