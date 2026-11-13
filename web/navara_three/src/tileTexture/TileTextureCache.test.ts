import { describe, it, expect, vi } from "vitest";

import { TileTextureCache } from "./TileTextureCache";
import type { AtlasFactory, CompositeAtlas } from "./types";

function makeFakeAtlas(withNormal: boolean): CompositeAtlas {
  // Minimal stand-ins for Texture / WebGLRenderTarget — the cache only checks
  // identity (acquire returns the same Texture instance) and lifecycle.
  const tex = (name: string) =>
    ({ name, needsUpdate: false }) as unknown as CompositeAtlas["color"];
  return {
    target: { dispose: vi.fn() } as unknown as CompositeAtlas["target"],
    color: tex("color"),
    attr: tex("attr"),
    normal: withNormal ? tex("normal") : null,
    dispose: vi.fn(),
  };
}

function makeCache(maxPooled = 0) {
  const factory = vi.fn<AtlasFactory>((_size, withNormal) =>
    makeFakeAtlas(withNormal),
  );
  const cache = new TileTextureCache({
    size: 512,
    atlasFactory: factory,
    maxPooled,
  });
  return { cache, factory };
}

/** What `TileTextureCompositor.runCompositePassIfDirty` does to the atlas. */
function bake(
  cache: TileTextureCache,
  handle: bigint,
  withNormal = false,
): CompositeAtlas {
  const atlas = cache.prepareAtlasForBake(handle, withNormal);
  if (!atlas) throw new Error("expected entry to exist");
  return atlas;
}

describe("TileTextureCache.acquire", () => {
  it("creates one entry per handle even across multiple acquires", () => {
    const { cache } = makeCache();
    const a = cache.acquire(1n);
    const b = cache.acquire(1n);
    expect(a).toBe(b);
    expect(cache.size).toBe(1);
  });

  it("takes no atlas until the first composite pass", () => {
    const { cache, factory } = makeCache();
    const out = cache.acquire(1n);

    expect(factory).not.toHaveBeenCalled();
    expect(cache.getEntry(1n)?.atlas).toBeNull();
    expect(out).toMatchObject({ color: null, attr: null, normal: null });

    const atlas = bake(cache, 1n);
    expect(factory).toHaveBeenCalledWith(512, false);
    expect(out).toMatchObject({
      color: atlas.color,
      attr: atlas.attr,
      normal: null,
    });
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
    const atlas = bake(cache, 1n);

    cache.release(1n);
    expect(atlas.dispose).not.toHaveBeenCalled();
    expect(cache.size).toBe(1);

    cache.release(1n);
    expect(atlas.dispose).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);

    // A subsequent acquire reuses the slot but spins up a fresh atlas.
    cache.acquire(1n);
    bake(cache, 1n);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("releases a never-baked entry without touching the pool", () => {
    const { cache, factory } = makeCache(2);
    cache.acquire(1n);
    cache.release(1n);

    expect(factory).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
    expect(cache.pooledCount).toBe(0);
  });

  it("is a no-op for unknown handles", () => {
    const { cache } = makeCache();
    expect(() => cache.release(999n)).not.toThrow();
  });
});

describe("TileTextureCache.releaseAtlas", () => {
  it("pools the atlas and leaves the entry dirty for the next pass", () => {
    const { cache } = makeCache(2);
    const out = cache.acquire(1n);
    const atlas = bake(cache, 1n);
    cache.consumeDirty(1n);

    cache.releaseAtlas(1n);

    expect(cache.getEntry(1n)?.atlas).toBeNull();
    expect(out.color).toBeNull();
    expect(atlas.dispose).not.toHaveBeenCalled();
    expect(cache.pooledCount).toBe(1);
    expect(cache.isDirty(1n)).toBe(true);

    // The next pass takes the atlas back.
    expect(bake(cache, 1n)).toBe(atlas);
  });

  it("keeps the atlas while a second holder shares the entry", () => {
    const { cache } = makeCache(2);
    cache.acquire(1n);
    cache.acquire(1n);
    const atlas = bake(cache, 1n);
    cache.consumeDirty(1n);

    expect(cache.releaseAtlas(1n)).toBe(false);

    expect(cache.getEntry(1n)?.atlas).toBe(atlas);
    expect(cache.isDirty(1n)).toBe(false);

    // The replaced mesh is gone: the atlas goes back to the pool.
    cache.release(1n);
    expect(cache.releaseAtlas(1n)).toBe(true);
    expect(cache.getEntry(1n)?.atlas).toBeNull();
    expect(cache.pooledCount).toBe(1);
  });

  it("leaves an entry without an atlas clean", () => {
    const { cache } = makeCache(2);
    cache.acquire(1n);
    cache.consumeDirty(1n);

    cache.releaseAtlas(1n);

    expect(cache.isDirty(1n)).toBe(false);
    expect(cache.pooledCount).toBe(0);
  });
});

describe("TileTextureCache atlas pooling", () => {
  it("pools a fully-released atlas and reuses it for the next bake", () => {
    const { cache, factory } = makeCache(2);
    cache.acquire(1n);
    const atlas = bake(cache, 1n);

    cache.release(1n);
    expect(atlas.dispose).not.toHaveBeenCalled();
    expect(cache.pooledCount).toBe(1);

    // Reused for a different handle, without a factory call.
    const out = cache.acquire(2n);
    bake(cache, 2n);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(out.color).toBe(atlas.color);
    expect(cache.pooledCount).toBe(0);
  });

  it("marks an entry backed by a pooled atlas fully dirty so it gets repainted", () => {
    const { cache } = makeCache(2);
    cache.acquire(1n);
    bake(cache, 1n);
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

  it("disposes the oldest pooled atlas once the pool is full", () => {
    const { cache } = makeCache(1);
    cache.acquire(1n);
    cache.acquire(2n);
    const a1 = bake(cache, 1n);
    const a2 = bake(cache, 2n);

    cache.release(1n);
    expect(a1.dispose).not.toHaveBeenCalled();
    expect(cache.pooledCount).toBe(1);

    cache.release(2n);
    expect(a1.dispose).toHaveBeenCalledTimes(1);
    expect(a2.dispose).not.toHaveBeenCalled();
    expect(cache.pooledCount).toBe(1);
    cache.acquire(3n);
    expect(bake(cache, 3n)).toBe(a2);
  });

  it("disposeAll drains the pool", () => {
    const { cache } = makeCache(2);
    cache.acquire(1n);
    const atlas = bake(cache, 1n);
    cache.release(1n);
    expect(cache.pooledCount).toBe(1);

    cache.disposeAll();
    expect(atlas.dispose).toHaveBeenCalledTimes(1);
    expect(cache.pooledCount).toBe(0);
  });
});

describe("TileTextureCache.prepareAtlasForBake", () => {
  it("gives the first bake an atlas of the requested shape", () => {
    const { cache, factory } = makeCache();
    const out = cache.acquire(1n);

    const atlas = bake(cache, 1n, true);

    expect(factory).toHaveBeenCalledExactlyOnceWith(512, true);
    expect(out.normal).toBe(atlas.normal);
    expect(atlas.normal).not.toBeNull();
  });

  it("keeps the atlas while the shape is unchanged", () => {
    const { cache, factory } = makeCache();
    cache.acquire(1n);
    const atlas = bake(cache, 1n, true);

    expect(bake(cache, 1n, true)).toBe(atlas);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("swaps the atlas when the shape changes, and the outputs follow", () => {
    const { cache, factory } = makeCache();
    const out = cache.acquire(1n);
    const plain = bake(cache, 1n, false);

    const withNormal = bake(cache, 1n, true);
    expect(factory).toHaveBeenLastCalledWith(512, true);
    // Every holder of the outputs follows the swap.
    expect(cache.getOutputs(1n)).toBe(out);
    expect(out).toMatchObject({
      color: withNormal.color,
      attr: withNormal.attr,
      normal: withNormal.normal,
    });
    // Pooling is disabled here, so the replaced atlas is freed.
    expect(plain.dispose).toHaveBeenCalledOnce();

    bake(cache, 1n, false);
    expect(out.normal).toBeNull();
    expect(withNormal.dispose).toHaveBeenCalledOnce();
  });

  it("takes a pooled atlas of the requested shape and pools the replaced one", () => {
    const { cache, factory } = makeCache(3);
    cache.acquire(1n);
    cache.acquire(2n);
    const withNormal = bake(cache, 1n, true);
    bake(cache, 2n, false);
    cache.release(1n);
    cache.release(2n);
    expect(cache.pooledCount).toBe(2);

    // The most recently pooled atlas has no normals; a bake that needs them
    // finds the one that does deeper in the pool instead of creating another.
    cache.acquire(3n);
    expect(bake(cache, 3n, true)).toBe(withNormal);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(cache.pooledCount).toBe(1);

    // A later swap pools the replaced atlas.
    const plain = bake(cache, 3n, false);
    expect(plain.normal).toBeNull();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(withNormal.dispose).not.toHaveBeenCalled();
    expect(cache.pooledCount).toBe(1);
  });

  it("keeps reusing released atlases while every tile has hillshade", () => {
    const { cache, factory } = makeCache(4);
    const live: bigint[] = [];
    for (let h = 1n; h <= 10n; h++) {
      cache.acquire(h);
      bake(cache, h, true);
      live.push(h);
    }
    const created = factory.mock.calls.length;

    // Pan: one tile leaves, one enters and is baked.
    for (let h = 11n; h <= 30n; h++) {
      cache.release(live.shift() ?? 0n);
      cache.acquire(h);
      bake(cache, h, true);
      live.push(h);
    }

    expect(factory).toHaveBeenCalledTimes(created);
  });

  it("refills the pool with the shape tiles release after hillshade goes away", () => {
    const { cache, factory } = makeCache(4);
    const live: bigint[] = [];
    for (let h = 1n; h <= 8n; h++) {
      cache.acquire(h);
      bake(cache, h, true);
      live.push(h);
    }
    for (const h of live.splice(0, 4)) cache.release(h);
    for (const h of live) bake(cache, h, false);

    // Released atlases without normals push the old ones out of the pool,
    // so the factory runs only until the pool has turned over.
    let calls = 0;
    for (let h = 9n; h <= 20n; h++) {
      cache.release(live.shift() ?? 0n);
      const before = factory.mock.calls.length;
      cache.acquire(h);
      bake(cache, h, false);
      live.push(h);
      if (h > 12n) calls += factory.mock.calls.length - before;
    }

    expect(calls).toBe(0);
  });

  it("returns undefined for unknown handles", () => {
    const { cache, factory } = makeCache();
    expect(cache.prepareAtlasForBake(999n, true)).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(factory).not.toHaveBeenCalled();
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
    const a1 = bake(cache, 1n);
    const a2 = bake(cache, 2n, true);
    // A never-baked entry has nothing to dispose.
    cache.acquire(3n);

    cache.disposeAll();
    expect(a1.dispose).toHaveBeenCalledTimes(1);
    expect(a2.dispose).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });
});
