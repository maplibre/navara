import { describe, it, expect, vi } from "vitest";

import { TileTextureCache } from "./TileTextureCache";
import type { AtlasFactory, CompositeAtlas } from "./types";

function makeFakeAtlas(): CompositeAtlas {
  // Minimal stand-ins for Texture / WebGLRenderTarget — the cache only checks
  // identity (acquire returns the same Texture instance) and lifecycle.
  const tex = (name: string) =>
    ({ name, needsUpdate: false }) as unknown as CompositeAtlas["color"];
  return {
    target: { dispose: vi.fn() } as unknown as CompositeAtlas["target"],
    color: tex("color"),
    attr: tex("attr"),
    normal: tex("normal"),
    allocated: false,
    dispose: vi.fn(),
  };
}

function makeCache(maxPooled = 0) {
  const factory = vi.fn<AtlasFactory>(() => makeFakeAtlas());
  const cache = new TileTextureCache({
    size: 512,
    atlasFactory: factory,
    maxPooled,
  });
  return { cache, factory };
}

describe("TileTextureCache.acquire", () => {
  it("creates exactly one atlas per handle even across multiple acquires", () => {
    const { cache, factory } = makeCache();
    const a = cache.acquire(1n);
    const b = cache.acquire(1n);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(a.color).toBe(b.color);
    expect(cache.size).toBe(1);
  });

  it("newly-acquired handles start dirty in every reason category", () => {
    const { cache } = makeCache();
    cache.acquire(1n);
    const reasons = cache.consumeDirty(1n);
    expect(reasons).not.toBeNull();
    // First composite must run, so all reason categories present.
    expect(reasons?.has("material")).toBe(true);
    expect(reasons?.has("texture-binding")).toBe(true);
    expect(reasons?.has("vector-revision")).toBe(true);
    expect(reasons?.has("raster-revision")).toBe(true);
    expect(reasons?.has("hillshade")).toBe(true);
  });
});

describe("TileTextureCache.release", () => {
  it("disposes atlas only when refCount reaches zero (pooling disabled)", () => {
    const { cache, factory } = makeCache();
    cache.acquire(1n);
    cache.acquire(1n);
    const entry = cache.getEntry(1n);
    if (!entry) throw new Error("expected entry to exist");
    const atlas = entry.atlas;

    cache.release(1n);
    expect(atlas.dispose).not.toHaveBeenCalled();
    expect(cache.size).toBe(1);

    cache.release(1n);
    expect(atlas.dispose).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);

    // A subsequent acquire reuses the slot but spins up a fresh atlas.
    cache.acquire(1n);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("is a no-op for unknown handles", () => {
    const { cache } = makeCache();
    expect(() => cache.release(999n)).not.toThrow();
  });
});

describe("TileTextureCache atlas pooling", () => {
  it("pools a fully-released atlas and reuses it for the next acquire", () => {
    const { cache, factory } = makeCache(2);
    cache.acquire(1n);
    const entry = cache.getEntry(1n);
    if (!entry) throw new Error("expected entry to exist");
    const atlas = entry.atlas;

    cache.release(1n);
    expect(atlas.dispose).not.toHaveBeenCalled();
    expect(cache.pooledCount).toBe(1);

    // Reused for a different handle, without a factory call.
    const out = cache.acquire(2n);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(out.color).toBe(atlas.color);
    expect(cache.pooledCount).toBe(0);
  });

  it("marks an entry backed by a pooled atlas fully dirty so it gets repainted", () => {
    const { cache } = makeCache(2);
    cache.acquire(1n);
    cache.consumeDirty(1n);
    cache.release(1n);

    cache.acquire(2n);
    const reasons = cache.consumeDirty(2n);
    expect(reasons?.has("material")).toBe(true);
    expect(reasons?.has("texture-binding")).toBe(true);
    expect(reasons?.has("vector-revision")).toBe(true);
    expect(reasons?.has("raster-revision")).toBe(true);
    expect(reasons?.has("hillshade")).toBe(true);
  });

  it("disposes released atlases once the pool is full", () => {
    const { cache } = makeCache(1);
    cache.acquire(1n);
    cache.acquire(2n);
    const e1 = cache.getEntry(1n);
    const e2 = cache.getEntry(2n);
    if (!e1 || !e2) throw new Error("expected both entries");

    cache.release(1n);
    expect(e1.atlas.dispose).not.toHaveBeenCalled();
    expect(cache.pooledCount).toBe(1);

    cache.release(2n);
    expect(e2.atlas.dispose).toHaveBeenCalledTimes(1);
    expect(cache.pooledCount).toBe(1);
  });

  it("disposeAll drains the pool", () => {
    const { cache } = makeCache(2);
    cache.acquire(1n);
    const entry = cache.getEntry(1n);
    if (!entry) throw new Error("expected entry to exist");
    const atlas = entry.atlas;
    cache.release(1n);
    expect(cache.pooledCount).toBe(1);

    cache.disposeAll();
    expect(atlas.dispose).toHaveBeenCalledTimes(1);
    expect(cache.pooledCount).toBe(0);
  });
});

describe("TileTextureCache.markDirty + consumeDirty", () => {
  it("coalesces multiple markDirty calls into a single consume result", () => {
    const { cache } = makeCache();
    cache.acquire(1n);
    // Drain the initial-acquire dirty set so we test markDirty in isolation.
    cache.consumeDirty(1n);

    cache.markDirty(1n, "hillshade");
    cache.markDirty(1n, "vector-revision");
    cache.markDirty(1n, "hillshade"); // duplicate

    const reasons = cache.consumeDirty(1n);
    expect(reasons?.size).toBe(2);
    expect(reasons?.has("hillshade")).toBe(true);
    expect(reasons?.has("vector-revision")).toBe(true);
  });

  it("consumeDirty leaves the entry clean", () => {
    const { cache } = makeCache();
    cache.acquire(1n);
    cache.consumeDirty(1n);
    expect(cache.isDirty(1n)).toBe(false);
    expect(cache.consumeDirty(1n)).toBeNull();
  });

  it("markDirty on unknown handle is a no-op (no entry created)", () => {
    const { cache } = makeCache();
    cache.markDirty(42n, "hillshade");
    expect(cache.size).toBe(0);
    expect(cache.consumeDirty(42n)).toBeNull();
  });
});

describe("TileTextureCache dev refcount diagnostics", () => {
  it("logs an error on release without acquire", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cache } = makeCache();
    cache.release(999n);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("double release or release without acquire"),
    );
    spy.mockRestore();
  });

  it("logs an error on double release", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cache } = makeCache();
    cache.acquire(1n);
    cache.release(1n);
    // Entry is gone after the first release, so this is release-without-entry.
    cache.release(1n);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("logs an error when disposeAll finds live refcounts", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cache } = makeCache();
    cache.acquire(1n);
    cache.disposeAll();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("leaked acquire"));
    spy.mockRestore();
  });
});

describe("TileTextureCache.disposeAll", () => {
  it("disposes every atlas and clears the cache", () => {
    const { cache } = makeCache();
    cache.acquire(1n);
    cache.acquire(2n);
    const e1 = cache.getEntry(1n);
    const e2 = cache.getEntry(2n);
    if (!e1 || !e2) throw new Error("expected both entries");
    const a1 = e1.atlas;
    const a2 = e2.atlas;

    cache.disposeAll();
    expect(a1.dispose).toHaveBeenCalledTimes(1);
    expect(a2.dispose).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });
});
