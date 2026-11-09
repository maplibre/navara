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
// target per terrain tile swap; a few released atlases let the next acquire
// reuse one. Kept small on purpose: a pooled spare belongs to no tile, so the
// per-tile ledger does not see its GPU memory.
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
   * Acquire (or create) the atlas for a handle. Refcounted: a TileMesh
   * acquires once on construction and releases once on dispose.
   * Newly-created entries start dirty in every category so the first composite
   * pass paints them — which also repaints any stale content in a pooled
   * atlas, so reuse needs no explicit clear.
   */
  acquire(handle: TileHandle): CompositeOutputs {
    let entry = this.entries.get(handle);
    if (!entry) {
      // Any pooled atlas will do: the first composite pass gives it the
      // tile's shape (see `setNormalAttachment`) before rendering into it.
      const atlas =
        this.pool.pop() ?? this.opts.atlasFactory(this.opts.size, false);
      entry = {
        handle,
        atlas,
        outputs: { color: atlas.color, attr: atlas.attr, normal: atlas.normal },
        refCount: 0,
        dirty: new Set<DirtyReason>([
          "material",
          "texture-binding",
          "vector-revision",
          "raster-revision",
          "hillshade",
        ]),
      };
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
      this.recycle(entry.atlas);
      this.entries.delete(handle);
    }
  }

  /**
   * Give the handle's atlas a normal attachment iff `withNormal`, replacing
   * the atlas (with a pooled one of that shape when there is one) when it has
   * the other shape. The replacement starts with undefined contents, so call
   * this only right before rendering the whole atlas. The entry's outputs
   * switch to the new textures in place; the replaced atlas goes to
   * `recycle`. Returns whether the atlas changed.
   */
  setNormalAttachment(handle: TileHandle, withNormal: boolean): boolean {
    const entry = this.entries.get(handle);
    if (!entry || (entry.atlas.normal !== null) === withNormal) return false;
    const previous = entry.atlas;
    const index = this.pool.findIndex(
      (atlas) => (atlas.normal !== null) === withNormal,
    );
    const atlas =
      index >= 0
        ? this.pool.splice(index, 1)[0]
        : this.opts.atlasFactory(this.opts.size, withNormal);
    entry.atlas = atlas;
    entry.outputs.color = atlas.color;
    entry.outputs.attr = atlas.attr;
    entry.outputs.normal = atlas.normal;
    this.recycle(previous);
    return true;
  }

  /**
   * Pool an atlas no tile uses any more. An atlas that was never rendered is
   * disposed instead: it holds no GPU memory, and pooling it would push out a
   * rendered one. A full pool disposes its oldest atlas, so the pool follows
   * the shape tiles currently release.
   */
  private recycle(atlas: CompositeAtlas): void {
    if (!atlas.allocated || this.maxPooled === 0) {
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
      entry.atlas.dispose();
    }
    this.entries.clear();
    for (const atlas of this.pool) {
      atlas.dispose();
    }
    this.pool.length = 0;
  }
}
