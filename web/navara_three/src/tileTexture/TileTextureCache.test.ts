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
    allocated: false,
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

/** Mark a handle's atlas as rendered, as the composite pass does. */
function rendered(cache: TileTextureCache, handle: bigint) {
  const entry = cache.getEntry(handle);
  if (!entry) throw new Error("expected entry to exist");
  entry.atlas.allocated = true;
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
    rendered(cache, 1n);
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
    rendered(cache, 1n);
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
    rendered(cache, 1n);
    rendered(cache, 2n);
    const e1 = cache.getEntry(1n);
    const e2 = cache.getEntry(2n);
    if (!e1 || !e2) throw new Error("expected both entries");

    cache.release(1n);
    expect(e1.atlas.dispose).not.toHaveBeenCalled();
    expect(cache.pooledCount).toBe(1);

    cache.release(2n);
    expect(e1.atlas.dispose).toHaveBeenCalledTimes(1);
    expect(e2.atlas.dispose).not.toHaveBeenCalled();
    expect(cache.pooledCount).toBe(1);
    expect(cache.acquire(3n).color).toBe(e2.atlas.color);
  });

  it("disposeAll drains the pool", () => {
    const { cache } = makeCache(2);
    cache.acquire(1n);
    rendered(cache, 1n);
    const entry = cache.getEntry(1n);
    if (!entry) throw new Error("expected entry to exist");
    const atlas = entry.atlas;
    cache.release(1n);
    expect(cache.pooledCount).toBe(1);

    cache.disposeAll();
    expect(atlas.dispose).toHaveBeenCalledTimes(1);
    expect(cache.pooledCount).toBe(0);
  });

  it("disposes a never-rendered atlas on release instead of pooling it", () => {
    const { cache } = makeCache(2);
    cache.acquire(1n);
    const unrendered = cache.getEntry(1n)?.atlas;

    cache.release(1n);

    expect(unrendered?.dispose).toHaveBeenCalledOnce();
    expect(cache.pooledCount).toBe(0);
  });

  it("keeps rendered atlases in a full pool when never-rendered tiles are released", () => {
    const { cache, factory } = makeCache(2);
    for (let h = 1n; h <= 4n; h++) cache.acquire(h);
    rendered(cache, 1n);
    rendered(cache, 2n);
    const kept = [cache.getEntry(1n)?.atlas, cache.getEntry(2n)?.atlas];
    cache.release(1n);
    cache.release(2n);

    // Tiles that never reached a composite pass, e.g. culled ones.
    cache.release(3n);
    cache.release(4n);

    for (const atlas of kept) expect(atlas?.dispose).not.toHaveBeenCalled();
    cache.acquire(5n);
    cache.acquire(6n);
    expect(factory).toHaveBeenCalledTimes(4);
    expect([cache.getEntry(5n)?.atlas, cache.getEntry(6n)?.atlas]).toEqual(
      expect.arrayContaining(kept),
    );
  });
});

/** What `TileTextureCompositor.runCompositePassIfDirty` does to the atlas. */
function bake(cache: TileTextureCache, handle: bigint, hillshade: boolean) {
  cache.setNormalAttachment(handle, hillshade);
  rendered(cache, handle);
}

describe("TileTextureCache normal attachment", () => {
  it("creates atlases without the normal attachment", () => {
    const { cache, factory } = makeCache();
    const out = cache.acquire(1n);

    expect(factory).toHaveBeenCalledWith(512, false);
    expect(cache.getEntry(1n)?.atlas.normal).toBeNull();
    expect(out.normal).toBeNull();
  });

  it("swaps in an atlas with the normal attachment and back, updating the outputs in place", () => {
    const { cache, factory } = makeCache();
    const out = cache.acquire(1n);
    const small = cache.getEntry(1n)?.atlas;
    if (!small) throw new Error("expected entry to exist");

    cache.setNormalAttachment(1n, true);
    expect(factory).toHaveBeenLastCalledWith(512, true);
    const big = cache.getEntry(1n)?.atlas;
    if (!big?.normal) throw new Error("expected an atlas with normals");
    // Every holder of the outputs follows the swap.
    expect(cache.getOutputs(1n)).toBe(out);
    expect(out).toMatchObject({
      color: big.color,
      attr: big.attr,
      normal: big.normal,
    });
    // Pooling is disabled here, so the replaced atlas is freed.
    expect(small.dispose).toHaveBeenCalledOnce();

    cache.setNormalAttachment(1n, true);
    expect(cache.getEntry(1n)?.atlas).toBe(big);
    expect(factory).toHaveBeenCalledTimes(2);

    cache.setNormalAttachment(1n, false);
    expect(cache.getEntry(1n)?.atlas.normal).toBeNull();
    expect(out.normal).toBeNull();
    expect(big.dispose).toHaveBeenCalledOnce();
  });

  it("takes a pooled atlas of the requested shape and pools the replaced one", () => {
    const { cache, factory } = makeCache(3);
    cache.acquire(1n);
    cache.acquire(2n);
    cache.setNormalAttachment(1n, true);
    rendered(cache, 1n);
    rendered(cache, 2n);
    const withNormal = cache.getEntry(1n)?.atlas;
    cache.release(1n);
    cache.release(2n);
    expect(cache.pooledCount).toBe(2);

    // The most recently pooled atlas has no normals; the swap finds the one
    // that does deeper in the pool instead of creating another.
    cache.acquire(3n);
    const plain = cache.getEntry(3n)?.atlas;
    expect(plain?.normal).toBeNull();
    cache.setNormalAttachment(3n, true);
    expect(cache.getEntry(3n)?.atlas).toBe(withNormal);
    expect(factory).toHaveBeenCalledTimes(3);
    expect(cache.pooledCount).toBe(1);
    expect(plain?.dispose).not.toHaveBeenCalled();
  });

  it("disposes a never-rendered atlas it replaces instead of pooling it", () => {
    const { cache } = makeCache(2);
    cache.acquire(1n);
    const unrendered = cache.getEntry(1n)?.atlas;

    cache.setNormalAttachment(1n, true);

    expect(unrendered?.dispose).toHaveBeenCalledOnce();
    expect(cache.pooledCount).toBe(0);
  });

  it("keeps reusing released atlases while every tile has hillshade", () => {
    const { cache, factory } = makeCache(4);
    const live: bigint[] = [];
    for (let h = 1n; h <= 10n; h++) {
      cache.acquire(h);
      live.push(h);
    }
    for (const h of live) bake(cache, h, true);
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

  it("is a no-op for unknown handles", () => {
    const { cache } = makeCache();
    cache.setNormalAttachment(999n, true);
    expect(cache.size).toBe(0);
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
