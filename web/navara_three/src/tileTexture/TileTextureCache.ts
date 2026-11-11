import type { TileHandle } from "@navaramap/core";

import type {
  AtlasFactory,
  CacheEntry,
  CompositeAtlas,
  CompositeOutputs,
  DirtyReason,
} from "./types";

/** Dev-build-only refcount diagnostics (never throws in production). */
const DEV =
  typeof import.meta !== "undefined" && !!(import.meta as ImportMeta).env?.DEV;

// Tile churn during pan/zoom would allocate and dispose a 2–3MB MRT render
// target per terrain tile swap; a few released atlases let the next tile's
// first composite pass reuse one. Kept small on purpose: a pooled spare
// belongs to no tile, so the per-tile ledger does not see its GPU memory.
const DEFAULT_MAX_POOLED_ATLASES = 4;

export type TileTextureCacheOptions = {
  /** Side length (in pixels) of the composite render targets. */
  size: number;
  /** Builds the MRT atlas. Injected so unit tests pass fakes. */
  atlasFactory: AtlasFactory;
  /** Max spare atlases kept for reuse instead of disposed. 0 disables pooling. */
  maxPooled?: number;
};

/**
 * Pure cache layer for per-tile composite atlases.
 *
 * Why: TileMesh previously owned its own WebGLRenderTargets and had no way to
 * coalesce updates from independent sources (vector revision, hillshade
 * backfill, material change). Lifting these responsibilities here lets the
 * compositor render N source textures into one atlas only when something
 * actually changes, and makes the bookkeeping testable without three.js.
 */
export class TileTextureCache {
  private readonly entries = new Map<TileHandle, CacheEntry>();
  private readonly opts: TileTextureCacheOptions;
  private readonly pool: CompositeAtlas[] = [];
  private readonly maxPooled: number;

  constructor(opts: TileTextureCacheOptions) {
    this.opts = opts;
    this.maxPooled = opts.maxPooled ?? DEFAULT_MAX_POOLED_ATLASES;
  }

  /**
   * Acquire (or create) the entry for a handle. Refcounted: a TileMesh
   * acquires once on construction and releases once on dispose.
   * Newly-created entries have no atlas yet (the first composite pass picks
   * one of the shape the tile needs, see `prepareAtlasForBake`) and start
   * dirty in every category so that pass runs — which also repaints any stale
   * content in a pooled atlas, so reuse needs no explicit clear.
   */
  acquire(handle: TileHandle): CompositeOutputs {
    let entry = this.entries.get(handle);
    if (!entry) {
      entry = createEntry(handle);
      this.entries.set(handle, entry);
    }
    entry.refCount++;
    return entry.outputs;
  }

  /**
   * Decrement refcount. When the last holder releases, the entry is forgotten
   * and its atlas goes to `recycle`.
   */
  release(handle: TileHandle): void {
    const entry = this.entries.get(handle);
    if (!entry) {
      if (DEV) {
        console.error(
          `TileTextureCache.release: no entry for handle ${handle} (double release or release without acquire)`,
        );
      }
      return;
    }
    entry.refCount--;
    if (DEV && entry.refCount < 0) {
      console.error(
        `TileTextureCache.release: refcount went negative for handle ${handle}`,
      );
    }
    if (entry.refCount <= 0) {
      if (entry.atlas) this.recycle(entry.atlas);
      this.entries.delete(handle);
    }
  }

  /**
   * The atlas the handle's composite pass renders into: one with a normal
   * attachment iff `withNormal`. Keeps the entry's atlas when it has that
   * shape; otherwise takes a pooled atlas of that shape (or creates one) and
   * recycles the previous atlas. A taken atlas holds undefined contents, so
   * call this only right before rendering the whole atlas.
   */
  prepareAtlasForBake(
    handle: TileHandle,
    withNormal: boolean,
  ): CompositeAtlas | undefined {
    const entry = this.entries.get(handle);
    if (!entry) return undefined;
    const previous = entry.atlas;
    if (previous && (previous.normal !== null) === withNormal) return previous;
    const index = this.pool.findIndex(
      (atlas) => (atlas.normal !== null) === withNormal,
    );
    entry.atlas =
      index >= 0
        ? this.pool.splice(index, 1)[0]
        : this.opts.atlasFactory(this.opts.size, withNormal);
    if (previous) this.recycle(previous);
    return entry.atlas;
  }

  /**
   * Pool a rendered atlas no tile uses any more. A full pool disposes its
   * oldest atlas, so the pool follows the shape tiles currently release.
   */
  private recycle(atlas: CompositeAtlas): void {
    if (this.maxPooled === 0) {
      atlas.dispose();
      return;
    }
    if (this.pool.length >= this.maxPooled) this.pool.shift()?.dispose();
    this.pool.push(atlas);
  }

  /** Mark an entry dirty for a given reason. No-op if handle isn't tracked. */
  markDirty(handle: TileHandle, reason: DirtyReason): void {
    const entry = this.entries.get(handle);
    if (!entry) return;
    entry.dirty.add(reason);
  }

  /**
   * Return the set of dirty reasons (and clear them) for a handle. Returns
   * null when the handle isn't tracked or has nothing dirty — compositor uses
   * that to skip the offscreen pass.
   */
  consumeDirty(handle: TileHandle): Set<DirtyReason> | null {
    const entry = this.entries.get(handle);
    if (!entry || entry.dirty.size === 0) return null;
    const reasons = entry.dirty;
    entry.dirty = new Set<DirtyReason>();
    return reasons;
  }

  /** Peek without clearing — used by the compositor's scheduling pass. */
  isDirty(handle: TileHandle): boolean {
    const entry = this.entries.get(handle);
    return !!entry && entry.dirty.size > 0;
  }

  /** Atlas accessor for the compositor's internal render path. */
  getEntry(handle: TileHandle): CacheEntry | undefined {
    return this.entries.get(handle);
  }

  /**
   * Return the outputs for a handle that was already acquired. Unlike
   * acquire(), does NOT touch the refcount — use this from places that just
   * need to bind the atlas textures (e.g. TileMesh.initMaterial after the
   * constructor already acquired the entry).
   */
  getOutputs(handle: TileHandle): CompositeOutputs | undefined {
    return this.entries.get(handle)?.outputs;
  }

  /** Iterate all live entries. Used by compositor.update(). */
  entriesIter(): IterableIterator<CacheEntry> {
    return this.entries.values();
  }

  /** Number of tracked entries (testing/debug). */
  get size(): number {
    return this.entries.size;
  }

  /** Number of pooled (unowned) spare atlases — for stats/debugging. */
  get pooledCount(): number {
    return this.pool.length;
  }

  /** Dispose all atlases (live and pooled) and clear. Called on view shutdown. */
  disposeAll(): void {
    for (const entry of this.entries.values()) {
      if (DEV && entry.refCount > 0) {
        console.error(
          `TileTextureCache.disposeAll: handle ${entry.handle} still has refcount ${entry.refCount} (leaked acquire)`,
        );
      }
      entry.atlas?.dispose();
    }
    this.entries.clear();
    for (const atlas of this.pool) {
      atlas.dispose();
    }
    this.pool.length = 0;
  }
}

/** A fresh entry with no atlas, dirty in every category. Its outputs read the
 * entry's current atlas, so they follow every `prepareAtlasForBake` swap. */
function createEntry(handle: TileHandle): CacheEntry {
  const entry: CacheEntry = {
    handle,
    atlas: null,
    outputs: {
      get color() {
        return entry.atlas?.color ?? null;
      },
      get attr() {
        return entry.atlas?.attr ?? null;
      },
      get normal() {
        return entry.atlas?.normal ?? null;
      },
    },
    refCount: 0,
    dirty: new Set<DirtyReason>([
      "material",
      "texture-binding",
      "vector-revision",
      "raster-revision",
      "hillshade",
    ]),
  };
  return entry;
}
