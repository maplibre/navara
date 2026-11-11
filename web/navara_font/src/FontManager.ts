import {
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

import { FontWorkerClient } from "./FontWorkerClient";
import { LRUMap } from "./LRUMap";
import type {
  FontAtlasData,
  FontFace,
  FontFamily,
  FontWorkerMemoryStats,
  GlyphMetrics,
  ShapedGlyph,
  ShapeTextResult,
  UnicodeRange,
} from "./types";

/** Internal cache key combining an identifier with a quality, so SDF and
 *  MSDF variants of the same font live as separate entries. */
const _q = (identifier: string, highQuality: boolean): string =>
  `${identifier}#q=${highQuality}`;

/** Create an SDF/MSDF distance-field atlas DataTexture.
 *
 * `channels`: 1 → R8 SDF (sampled as `.r`); 4 → RGBA8 MTSDF (three MSDF
 * channels + true SDF in alpha, sampled as `median(.rgb)`). RGB8 isn't
 * supported because three.js dropped `RGBFormat` in r137. */
export function createSdfAtlasTexture(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): DataTexture {
  const format = channels === 4 ? RGBAFormat : RedFormat;
  // Distance values are linear, not sRGB.
  return createAtlasTexture(data, width, height, format, NoColorSpace);
}

/** Create an RGBA color atlas DataTexture for COLRv1 glyphs.
 *  Pixel data is unpremultiplied sRGB; three.js linearizes on sample. */
export function createColorAtlasTexture(
  data: Uint8Array,
  width: number,
  height: number,
): DataTexture {
  return createAtlasTexture(data, width, height, RGBAFormat, SRGBColorSpace);
}

function createAtlasTexture(
  data: Uint8Array,
  width: number,
  height: number,
  format: typeof RedFormat | typeof RGBAFormat,
  colorSpace: typeof NoColorSpace | typeof SRGBColorSpace,
): DataTexture {
  const tex = new DataTexture(data, width, height, format, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Maximum number of shaped text results to cache before LRU eviction. */
const SHAPE_CACHE_MAX_SIZE = 10_000;

/** Decode the worker's flattened `[from, to, ...]` cmap range pairs. */
const decodeCmapRanges = (flat: Uint32Array): UnicodeRange[] => {
  const ranges: UnicodeRange[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    ranges.push({ from: flat[i], to: flat[i + 1] });
  }
  return ranges;
};

/**
 * Manages font loading, text shaping, and SDF atlas access.
 *
 * Delegates heavy computation (shaping, SDF rasterization, atlas packing)
 * to a dedicated Web Worker via FontWorkerClient. GPU texture management
 * (DataTexture creation/update) stays on the main thread.
 */
export class FontManager {
  private _workerUrl: string | URL;
  private _client: FontWorkerClient | undefined;
  private _clientPromise: Promise<FontWorkerClient> | undefined;
  /** Worker cache budget, delivered when the (lazy) client is created. */
  private _fontBudgetBytes: number | undefined;
  /** Delivered when the (lazy) client is created; see `setWorkerCoreReservation`. */
  private _reserveWorkerCore: (() => () => void) | undefined;
  /** Tracks in-flight fetch promises to avoid duplicate requests. */
  private _pending = new Map<string, Promise<void>>();
  /** Tracks fonts that have been successfully loaded. */
  private _loaded = new Set<string>();
  /** Cache shaped text results to avoid redundant worker calls (LRU-evicted). */
  private _shapeCache = new Map<string, LRUMap<string, ShapeTextResult>>();
  /** Cache atlas data per font to avoid redundant copies. */
  private _atlasCache = new Map<string, FontAtlasData>();
  /** Cache color atlas data per font (COLRv1 RGBA). */
  private _colorAtlasCache = new Map<string, FontAtlasData>();
  /** Tracks whether the atlas cache is stale (new glyphs may have been rasterized). */
  private _atlasDirty = new Set<string>();
  /** Tracks whether the color atlas cache is stale. */
  private _colorAtlasDirty = new Set<string>();
  /** Shared GPU texture per font — all meshes using the same font share one DataTexture. */
  private _textureCache = new Map<string, DataTexture>();
  /** Shared color atlas texture per atlas key (RGBA). */
  private _colorTextureCache = new Map<string, DataTexture>();
  /** Tracks in-flight prepareText promises to deduplicate. */
  private _preparePending = new Map<string, Promise<void>>();
  /** Microtask batch queue: per-font list of texts awaiting worker dispatch. */
  private _batchQueue = new Map<
    string,
    {
      text: string;
      cacheKey: string;
      resolve: () => void;
      reject: (reason: unknown) => void;
    }[]
  >();
  /** Whether a microtask flush is already scheduled. */
  private _batchScheduled = false;

  private _refCount = new Map<string, number>();
  /** Registered font families, keyed by family name. */
  private _families = new Map<string, FontFamily>();
  /** Real cmap coverage per font file URL, reported by the worker when the
   *  file is first loaded. Declared face ranges can differ from what the
   *  file contains (e.g. shared per-subset boilerplate in Google Fonts CSS
   *  claims codepoints the file lacks, which would shape as tofu), so
   *  registered faces pointing at the URL get their `unicodeRanges` replaced
   *  with these — once per file, never per shaped text. */
  private _cmapRanges = new Map<string, UnicodeRange[]>();
  /** Maps font URL → atlas key (family name or URL for standalone fonts). */
  private _atlasKeys = new Map<string, string>();

  /** Per-atlas generation counter. Bumped when the worker reports it evicted
   *  glyphs from an atlas; cached shape results carry the generation they were
   *  built under, so any from before the eviction are re-shaped on next use.
   *  Visible labels are *normally* unaffected — their glyphs are pinned and not
   *  evicted — but a large burst can evict a still-in-flight glyph before its
   *  retain lands; `onAtlasEvicted` lets consumers rebuild such stale meshes. */
  private _atlasGeneration = new Map<string, number>();
  /** Eviction listeners keyed by resolved atlas key. Notified (coalesced on a
   *  microtask) after an eviction bumps an atlas's generation, so visible
   *  consumers can rebuild meshes whose baked metrics may now be stale. */
  private _evictListeners = new Map<string, Set<() => void>>();
  /** Atlas keys with an eviction awaiting notification, plus its schedule flag. */
  private _pendingEvictNotify = new Set<string>();
  private _evictNotifyScheduled = false;
  /** Pending visible-label refcount increments per atlas key (one entry per
   *  occurrence), flushed to the worker on a microtask. */
  private _retainQueue = new Map<string, bigint[]>();
  /** Pending visible-label refcount decrements per atlas key. */
  private _releaseQueue = new Map<string, bigint[]>();
  /** Whether a retain/release flush is already scheduled. */
  private _refFlushScheduled = false;

  constructor(workerUrl: string | URL) {
    this._workerUrl = workerUrl;
  }

  /**
   * Register a font family with multiple faces.
   * No font files are loaded until text is prepared.
   */
  registerFontFamily(family: FontFamily): void {
    // Clone the faces so cmap corrections (see `_cmapRanges`) never mutate
    // caller-owned data; faces whose file was already loaded pick up their
    // real coverage immediately.
    this._families.set(family.family, {
      family: family.family,
      faces: family.faces.map((face) => ({
        url: face.url,
        unicodeRanges: this._cmapRanges.get(face.url) ?? face.unicodeRanges,
      })),
    });
  }

  /**
   * Remove a registered font family. No font resources are unloaded here —
   * each mesh that used this family tracks its loaded face URLs and unloads
   * them individually on dispose.
   */
  unregisterFontFamily(familyName: string): void {
    this._families.delete(familyName);
  }

  /** Check whether a font identifier is a registered family name. */
  isFamily(fontIdentifier: string): boolean {
    return this._families.has(fontIdentifier);
  }

  /**
   * Split `text` into runs of consecutive characters that map to the same face.
   * Each character picks the first face whose unicode ranges contain it,
   * falling back to face 0. Non-printing characters (spaces and C0/C1
   * controls) stick to the current run instead of picking a face — see the
   * loop body for why that is load-bearing.
   */
  private _segmentTextByFace(
    faces: FontFace[],
    text: string,
  ): { url: string; text: string }[] {
    if (faces.length === 0) {
      throw new Error("FontManager: font family has no faces");
    }
    if (faces.length === 1) return [{ url: faces[0].url, text }];

    const segments: { url: string; text: string }[] = [];
    let currentUrl = "";
    let currentText = "";

    for (const ch of text) {
      const codepoint = ch.codePointAt(0) ?? 0;
      // Characters that never carry a glyph must not drive face selection.
      // A space sticking to its run is cosmetic, but for `\n` and the other
      // C0/C1 controls it is load-bearing: Google Fonts' per-subset
      // `unicode-range` boilerplate makes dozens of faces *declare*
      // U+0000-00FF, while no font's cmap actually contains a newline. Letting
      // one pick a face means the cmap-refinement loop in `prepareText` finds
      // the codepoint uncovered after every load and re-routes it to the next
      // declaring face — walking the entire family, one face download per
      // pass. (Measured: a lone "\n" pulled 39 files across 17 Noto families.)
      // The shaper treats `\n` as a zero-advance hard break with no atlas
      // entry, so which face nominally owns it changes nothing downstream.
      const isNonPrinting =
        codepoint <= 0x20 || (codepoint >= 0x7f && codepoint <= 0x9f);
      const url = isNonPrinting
        ? // Attach to the current run, or to the fallback face when the text
          // opens with one — matching `_findFaceForCodepoint`'s own fallback.
          currentUrl || faces[0].url
        : this._findFaceForCodepoint(faces, codepoint);

      if (url === currentUrl) {
        currentText += ch;
      } else {
        if (currentText) segments.push({ url: currentUrl, text: currentText });
        currentUrl = url;
        currentText = ch;
      }
    }
    if (currentText) segments.push({ url: currentUrl, text: currentText });
    return segments;
  }

  /** First face whose unicode ranges contain `codepoint`, or face 0. */
  private _findFaceForCodepoint(faces: FontFace[], codepoint: number): string {
    for (const face of faces) {
      for (const range of face.unicodeRanges) {
        if (codepoint >= range.from && codepoint <= range.to) {
          return face.url;
        }
      }
    }
    return faces[0].url;
  }

  /** Replace the unicode ranges of every registered face pointing at
   *  `rawUrl` with the font file's real cmap coverage (see `_cmapRanges`). */
  private _applyCmapRanges(rawUrl: string): void {
    const ranges = this._cmapRanges.get(rawUrl);
    if (!ranges) return;
    for (const family of this._families.values()) {
      for (const face of family.faces) {
        if (face.url === rawUrl) face.unicodeRanges = ranges;
      }
    }
  }

  private _ensureClient(): Promise<FontWorkerClient> {
    if (this._client) return Promise.resolve(this._client);
    if (this._clientPromise) return this._clientPromise;
    this._clientPromise = (async () => {
      const client = new FontWorkerClient(this._workerUrl, {
        fontBudgetBytes: this._fontBudgetBytes,
        reserveWorkerCore: this._reserveWorkerCore,
      });
      await client.ready();
      this._client = client;
      return client;
    })();
    this._clientPromise.catch(() => {
      this._clientPromise = undefined;
    });
    return this._clientPromise;
  }

  /**
   * Sets the worker-side cache budget (font data + atlas pixels). Must be
   * called before the first font loads — the worker is created lazily and
   * the budget is delivered with its init message.
   */
  setMemoryBudget(bytes: number | undefined): void {
    this._fontBudgetBytes = bytes;
  }

  /**
   * Lets the font worker hold a core of the view's worker pool while it
   * loads fonts or shapes text (see `reserveWorkerCore` in
   * `@navaramap/worker`). Must be called before the first font loads, like
   * {@link setMemoryBudget}.
   */
  setWorkerCoreReservation(reserve: () => () => void): void {
    this._reserveWorkerCore = reserve;
  }

  /**
   * Snapshot of the font worker's memory usage, or `undefined` while no
   * worker has been spawned (no fonts in use = zero cost).
   */
  async memoryStats(): Promise<FontWorkerMemoryStats | undefined> {
    return this._client?.getMemoryStats();
  }

  /**
   * Load a font from a URL. Fetches the font file and sends it to the worker.
   * Returns immediately if the font is already loaded. Deduplicates concurrent requests.
   *
   * `atlasKey`: optional shared atlas identifier (e.g. font family name).
   * `highQuality`: which atlas raster path to use. Two materials referencing the
   * same `url` but different `highQuality` values produce two independent
   * (font, atlas) entries — both live side-by-side. The browser HTTP cache
   * makes the second fetch effectively free.
   */
  async loadFont(
    url: string,
    highQuality: boolean,
    atlasKey?: string,
  ): Promise<void> {
    const qUrl = _q(url, highQuality);
    if (this._loaded.has(qUrl)) {
      this._refCount.set(qUrl, (this._refCount.get(qUrl) ?? 0) + 1);
      return;
    }

    if (this._pending.has(qUrl)) {
      this._refCount.set(qUrl, (this._refCount.get(qUrl) ?? 0) + 1);
      return this._pending.get(qUrl);
    }

    // qAtlasKey is `undefined` (worker falls back to the URL, which is itself
    // already qualified) when the caller didn't supply an atlasKey. When they
    // did, we qualify it so families with the same name but different highQuality
    // get distinct atlases.
    const qAtlasKey = atlasKey ? _q(atlasKey, highQuality) : undefined;
    const promise = this._fetchAndLoad(url, qUrl, qAtlasKey, highQuality);
    this._refCount.set(qUrl, 1);
    this._pending.set(qUrl, promise);

    this._shapeCache.set(
      qUrl,
      new LRUMap<string, ShapeTextResult>(SHAPE_CACHE_MAX_SIZE),
    );

    try {
      await promise;
      this._loaded.add(qUrl);
      this._atlasKeys.set(qUrl, qAtlasKey ?? qUrl);
    } catch (err) {
      this._refCount.delete(qUrl);
      this._shapeCache.delete(qUrl);
      throw err;
    } finally {
      this._pending.delete(qUrl);
    }
  }

  async unloadFont(url: string, highQuality: boolean) {
    const qUrl = _q(url, highQuality);
    const count = this._refCount.get(qUrl);
    if (!count) return;
    if (count > 1) {
      this._refCount.set(qUrl, count - 1);
      return;
    }

    const atlasKey = this._atlasKeys.get(qUrl) ?? qUrl;
    this._loaded.delete(qUrl);
    this._refCount.delete(qUrl);
    this._shapeCache.delete(qUrl);
    this._atlasKeys.delete(qUrl);

    // Drop the atlas only when no other loaded font still references it.
    const stillReferenced = [...this._atlasKeys.values()].includes(atlasKey);
    if (!stillReferenced) {
      this._shapeCache.delete(atlasKey);
      this._atlasCache.delete(atlasKey);
      this._atlasDirty.delete(atlasKey);
      this._colorAtlasCache.delete(atlasKey);
      this._colorAtlasDirty.delete(atlasKey);
      this._atlasGeneration.delete(atlasKey);
      this._textureCache.get(atlasKey)?.dispose();
      this._textureCache.delete(atlasKey);
      this._colorTextureCache.get(atlasKey)?.dispose();
      this._colorTextureCache.delete(atlasKey);
    }

    if (this._client) {
      let result;
      try {
        result = await this._client.unloadFont(qUrl);
      } catch (err) {
        // `dispose()` terminated the worker, and the font with it.
        if (!this._client) return;
        throw err;
      }
      if (!result.ok) {
        console.warn(
          `Failed to unload font "${url}" (${highQuality}) in worker`,
        );
      }
    }
  }

  /**
   * Prepare text for rendering: shapes text and updates atlas in the worker.
   * Must be called (and awaited) before shapeText() will return data for this text.
   * Accepts either a font URL or a registered font family name.
   *
   * For font families, face URLs are loaded lazily — only the faces whose
   * unicode ranges cover `text` are fetched. Pass a caller-owned `loadedFaces`
   * Set to track which URLs were loaded; the caller must call unloadFont() for
   * each URL in the set on dispose. Passing the same set across multiple calls
   * ensures each face URL is loaded exactly once per caller.
   *
   * For standalone font URLs the font must already be loaded via loadFont().
   */
  async prepareText(
    fontIdentifier: string,
    text: string,
    highQuality: boolean,
    loadedFaces?: Set<string>,
  ): Promise<void> {
    if (!text) return;

    const family = this._families.get(fontIdentifier);
    if (family) {
      // Lazy path: load only the face URLs needed for this text that this
      // caller has not loaded yet. `loadedFaces` tracks raw face URLs (no
      // highQuality suffix), matching the URLs the caller later passes to
      // `unloadFont(url, highQuality)`. A single set is therefore tied to one
      // highQuality — callers switching highQuality should use a fresh set.
      const tracker = loadedFaces ?? new Set<string>();
      // Load faces until segmentation is stable: the first load of a font
      // file replaces its faces' declared unicode ranges with the file's
      // real cmap coverage (see `_cmapRanges`), which can re-route
      // codepoints the declared ranges over-promised to another face. Each
      // iteration loads at least one new face, so the loop is bounded by
      // the face count.
      let passesLeft = family.faces.length + 1;
      while (passesLeft-- > 0) {
        const segments = this._segmentTextByFace(family.faces, text);
        const missing = [...new Set(segments.map((s) => s.url))].filter(
          (url) => !tracker.has(url),
        );
        if (missing.length === 0) break;
        await Promise.all(
          missing.map(async (url) => {
            await this.loadFont(url, highQuality, fontIdentifier);
            tracker.add(url);
          }),
        );
      }
      return this._prepareFamilyText(fontIdentifier, family, text, highQuality);
    }

    return this._prepareSingleFontText(fontIdentifier, text, highQuality);
  }

  /**
   * Check if text has been prepared (sync).
   * Accepts either a font URL or a registered font family name.
   */
  isTextPrepared(
    fontIdentifier: string,
    text: string,
    highQuality: boolean,
  ): boolean {
    return this._isPreparedFresh(
      _q(fontIdentifier, highQuality),
      text,
      this._resolveAtlasKey(fontIdentifier, highQuality),
    );
  }

  /**
   * Get shaped text from cache. Returns undefined if not yet prepared.
   * Call prepareText() first.
   * Accepts either a font URL or a registered font family name.
   */
  shapeText(
    fontIdentifier: string,
    text: string,
    highQuality: boolean,
  ): ShapeTextResult | undefined {
    return this._shapeCache.get(_q(fontIdentifier, highQuality))?.get(text);
  }

  /** Prepare text for a single standalone font (non-family path). */
  private async _prepareSingleFontText(
    fontUrl: string,
    text: string,
    highQuality: boolean,
  ): Promise<void> {
    const qUrl = _q(fontUrl, highQuality);
    const cacheKey = this._cacheKey(qUrl, text);
    if (
      this._isPreparedFresh(
        qUrl,
        text,
        this._resolveAtlasKey(fontUrl, highQuality),
      )
    )
      return;
    if (this._preparePending.has(cacheKey))
      return this._preparePending.get(cacheKey);

    const promise = new Promise<void>((resolve, reject) => {
      let queue = this._batchQueue.get(qUrl);
      if (!queue) {
        queue = [];
        this._batchQueue.set(qUrl, queue);
      }
      queue.push({ text, cacheKey, resolve, reject });
    });

    this._preparePending.set(cacheKey, promise);

    if (!this._batchScheduled) {
      this._batchScheduled = true;
      queueMicrotask(() => this._flushBatch());
    }

    try {
      await promise;
    } finally {
      this._preparePending.delete(cacheKey);
    }
  }

  /** Prepare text for a font family: segment, shape per-face, stitch. */
  private async _prepareFamilyText(
    familyName: string,
    family: FontFamily,
    text: string,
    highQuality: boolean,
  ): Promise<void> {
    const qFamily = _q(familyName, highQuality);
    // Already stitched and still current for the atlas?
    if (this._isPreparedFresh(qFamily, text, qFamily)) return;

    const pendingKey = this._cacheKey(qFamily, text);
    if (this._preparePending.has(pendingKey))
      return this._preparePending.get(pendingKey);

    const promise = (async () => {
      const segments = this._segmentTextByFace(family.faces, text);

      // Shape each segment. Face URLs were loaded lazily by prepareText above.
      await Promise.all(
        segments.map((seg) =>
          this._prepareSingleFontText(seg.url, seg.text, highQuality),
        ),
      );

      // Stitch per-segment results into one combined result
      const stitched = this._stitchSegments(segments, highQuality);

      let familyShapeCache = this._shapeCache.get(qFamily);
      if (!familyShapeCache) {
        familyShapeCache = new LRUMap<string, ShapeTextResult>(
          SHAPE_CACHE_MAX_SIZE,
        );
        this._shapeCache.set(qFamily, familyShapeCache);
      }
      // Stamp with the family atlas's current generation so an eviction
      // afterward marks this stitched result stale.
      stitched._generation = this._currentGen(qFamily);
      familyShapeCache.set(text, stitched);
    })();

    this._preparePending.set(pendingKey, promise);
    try {
      await promise;
    } finally {
      this._preparePending.delete(pendingKey);
    }
  }

  /** Combine shaped results from multiple face segments into one result.
   *
   * All glyph advances/offsets and bearing values are normalized to the first
   * segment's unitsPerEm so the consumer can apply a single scale factor.
   */
  private _stitchSegments(
    segments: { url: string; text: string }[],
    highQuality: boolean,
  ): ShapeTextResult {
    const allGlyphs: ShapedGlyph[] = [];
    const metricsMap = new Map<string, GlyphMetrics>();
    let targetUnitsPerEm = 0;
    // Line metrics come from the first shaped segment — the same face that
    // defines the target unitsPerEm, so no rescaling is needed.
    let ascender = 0;
    let descender = 0;
    let lineGap = 0;
    // Each face run reports on its own substring, so the label allows spacing
    // only when every run does.
    let allowsLetterSpacing = true;

    for (const seg of segments) {
      const result = this._shapeCache
        .get(_q(seg.url, highQuality))
        ?.get(seg.text);
      // A segment can be absent when the worker produced no glyphs for it: the
      // face matched by unicode range may not actually contain the codepoint, or
      // segmentation fell through to face 0 (which can't shape this script). The
      // prepare promise still resolves in that case (the result is simply never
      // cached), so skip the unshaped segment and stitch the rest rather than
      // aborting the whole label — one uncovered glyph shouldn't drop the name.
      if (!result) continue;

      if (targetUnitsPerEm === 0) {
        targetUnitsPerEm = result.unitsPerEm;
        ascender = result.ascender;
        descender = result.descender;
        lineGap = result.lineGap;
      }
      const scale = targetUnitsPerEm / result.unitsPerEm;
      allowsLetterSpacing &&= result.allowsLetterSpacing;

      for (const g of result.glyphs) {
        allGlyphs.push(
          scale === 1
            ? g
            : {
                ...g,
                xAdvance: g.xAdvance * scale,
                yAdvance: g.yAdvance * scale,
                xOffset: g.xOffset * scale,
                yOffset: g.yOffset * scale,
              },
        );
      }

      for (const m of result.metrics) {
        const key = `${m.fontIndex}:${m.glyphId}`;
        if (!metricsMap.has(key)) {
          metricsMap.set(key, m);
        }
      }
    }

    if (targetUnitsPerEm === 0) {
      // Every segment was unshaped (e.g. a name entirely in an uncovered
      // script). Return an empty result so the label renders blank instead of
      // throwing; `unitsPerEm` is irrelevant with zero glyphs but must be
      // nonzero so the consumer's scale factor stays finite.
      return {
        glyphs: [],
        metrics: [],
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        lineGap: 0,
        allowsLetterSpacing,
      };
    }

    return {
      glyphs: allGlyphs,
      metrics: [...metricsMap.values()],
      unitsPerEm: targetUnitsPerEm,
      ascender,
      descender,
      lineGap,
      allowsLetterSpacing,
    };
  }

  /**
   * Get the SDF atlas data for a loaded font from cache.
   * Accepts either a font URL or a registered font family name.
   * For families, the atlas is shared across all faces.
   */
  getAtlas(
    fontIdentifier: string,
    highQuality: boolean,
  ): FontAtlasData | undefined {
    const key = this._resolveAtlasKey(fontIdentifier, highQuality);
    return this._atlasCache.get(key);
  }

  /**
   * Shared GPU DataTexture for a font's atlas. Returns the same instance
   * across callers and updates it in-place when the atlas grows. Accepts a
   * font URL or a family name.
   */
  getAtlasTexture(
    fontIdentifier: string,
    highQuality: boolean,
  ): DataTexture | null {
    return this._getOrUpdateTexture(
      this._resolveAtlasKey(fontIdentifier, highQuality),
      this._atlasCache,
      this._atlasDirty,
      this._textureCache,
      (a) => createSdfAtlasTexture(a.data, a.width, a.height, a.channels),
    );
  }

  /** Color atlas data for a loaded COLRv1 font. `undefined` for monochrome. */
  getColorAtlas(
    fontIdentifier: string,
    highQuality: boolean,
  ): FontAtlasData | undefined {
    const key = this._resolveAtlasKey(fontIdentifier, highQuality);
    return this._colorAtlasCache.get(key);
  }

  /**
   * Shared GPU DataTexture for a font's COLRv1 color atlas. `null` when no
   * color glyphs have been rasterized under this key.
   */
  getColorAtlasTexture(
    fontIdentifier: string,
    highQuality: boolean,
  ): DataTexture | null {
    return this._getOrUpdateTexture(
      this._resolveAtlasKey(fontIdentifier, highQuality),
      this._colorAtlasCache,
      this._colorAtlasDirty,
      this._colorTextureCache,
      (a) => createColorAtlasTexture(a.data, a.width, a.height),
    );
  }

  /** Shared "get cached texture, create or refresh from atlas data" path.
   *  When the atlas grew, dispose() releases the GL handle so three.js
   *  reallocates at the new size on the next render instead of overflowing
   *  texSubImage2D. The DataTexture instance is preserved so existing meshes
   *  keep their refs. */
  private _getOrUpdateTexture(
    key: string,
    atlasCache: Map<string, FontAtlasData>,
    dirtySet: Set<string>,
    textureCache: Map<string, DataTexture>,
    create: (atlas: FontAtlasData) => DataTexture,
  ): DataTexture | null {
    if (!dirtySet.has(key)) {
      const cached = textureCache.get(key);
      if (cached) return cached;
    }

    const atlasData = atlasCache.get(key);
    if (!atlasData) return null;

    dirtySet.delete(key);

    const existing = textureCache.get(key);
    if (existing) {
      const dimsChanged =
        existing.image?.width !== atlasData.width ||
        existing.image?.height !== atlasData.height;
      if (dimsChanged) existing.dispose();
      existing.image = {
        data: atlasData.data,
        width: atlasData.width,
        height: atlasData.height,
      };
      existing.needsUpdate = true;
      return existing;
    }

    const tex = create(atlasData);
    textureCache.set(key, tex);
    return tex;
  }

  dispose() {
    for (const tex of this._textureCache.values()) tex.dispose();
    for (const tex of this._colorTextureCache.values()) tex.dispose();
    this._pending.clear();
    this._preparePending.clear();
    this._loaded.clear();
    this._refCount.clear();
    this._shapeCache.clear();
    this._atlasGeneration.clear();
    this._retainQueue.clear();
    this._releaseQueue.clear();
    this._refFlushScheduled = false;
    this._atlasCache.clear();
    this._atlasDirty.clear();
    this._colorAtlasCache.clear();
    this._colorAtlasDirty.clear();
    this._textureCache.clear();
    this._colorTextureCache.clear();
    this._families.clear();
    this._atlasKeys.clear();
    this._client?.dispose();
    this._client = undefined;
  }

  private _cacheKey(fontUrl: string, text: string): string {
    return fontUrl + "\0" + text;
  }

  /** Current generation of an atlas. Bumped whenever the atlas evicts glyphs;
   *  cached shape results stamped with an older generation are treated as
   *  stale (their metrics may point at reused rects) and re-shaped on next use. */
  private _currentGen(atlasKey: string): number {
    return this._atlasGeneration.get(atlasKey) ?? 0;
  }

  /** Whether `text` has a cached shape result that is still current for its
   *  atlas. A result from before the atlas last evicted is treated as not
   *  prepared, forcing a re-shape that re-rasterizes any evicted glyphs. */
  private _isPreparedFresh(
    shapeCacheKey: string,
    text: string,
    atlasKey: string,
  ): boolean {
    const entry = this._shapeCache.get(shapeCacheKey)?.get(text);
    return !!entry && (entry._generation ?? 0) === this._currentGen(atlasKey);
  }

  /**
   * Subscribe to evictions on the atlas backing `(fontIdentifier, highQuality)`.
   * The listener fires (coalesced on a microtask) after the worker reports that
   * atlas evicted glyphs — the cue for a visible consumer to rebuild any mesh
   * whose baked atlas rects may now be stale. Returns an unsubscribe function.
   */
  onAtlasEvicted(
    fontIdentifier: string,
    highQuality: boolean,
    listener: () => void,
  ): () => void {
    const atlasKey = this._resolveAtlasKey(fontIdentifier, highQuality);
    let set = this._evictListeners.get(atlasKey);
    if (!set) {
      set = new Set();
      this._evictListeners.set(atlasKey, set);
    }
    set.add(listener);
    return () => {
      const s = this._evictListeners.get(atlasKey);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this._evictListeners.delete(atlasKey);
    };
  }

  /** Queue an eviction notification for `atlasKey`, coalescing a burst of
   *  per-batch evictions into a single microtask-deferred fan-out. */
  private _scheduleEvictNotify(atlasKey: string): void {
    if (!this._evictListeners.has(atlasKey)) return;
    this._pendingEvictNotify.add(atlasKey);
    if (this._evictNotifyScheduled) return;
    this._evictNotifyScheduled = true;
    queueMicrotask(() => this._flushEvictNotify());
  }

  private _flushEvictNotify(): void {
    this._evictNotifyScheduled = false;
    const keys = this._pendingEvictNotify;
    this._pendingEvictNotify = new Set();
    for (const key of keys) {
      const set = this._evictListeners.get(key);
      if (!set) continue;
      // Snapshot: a listener may unsubscribe (or rebuild + re-subscribe) while
      // iterating.
      for (const listener of [...set]) listener();
    }
  }

  /**
   * Add one visible-label reference to each glyph (composite keys) so the
   * worker keeps them in the atlas while on screen. Call when a label using
   * these glyphs becomes visible; balance with {@link releaseGlyphs}.
   */
  retainGlyphs(
    fontIdentifier: string,
    highQuality: boolean,
    keys: bigint[],
  ): void {
    if (keys.length === 0) return;
    const atlasKey = this._resolveAtlasKey(fontIdentifier, highQuality);
    this._enqueueRef(this._retainQueue, atlasKey, keys);
  }

  /** Drop one visible-label reference from each glyph. Call when a label hides
   *  or is disposed. */
  releaseGlyphs(
    fontIdentifier: string,
    highQuality: boolean,
    keys: bigint[],
  ): void {
    if (keys.length === 0) return;
    const atlasKey = this._resolveAtlasKey(fontIdentifier, highQuality);
    this._enqueueRef(this._releaseQueue, atlasKey, keys);
  }

  private _enqueueRef(
    queue: Map<string, bigint[]>,
    atlasKey: string,
    keys: bigint[],
  ): void {
    let arr = queue.get(atlasKey);
    if (!arr) {
      arr = [];
      queue.set(atlasKey, arr);
    }
    for (const k of keys) arr.push(k);

    if (!this._refFlushScheduled) {
      this._refFlushScheduled = true;
      queueMicrotask(() => this._flushRefs());
    }
  }

  /** Send queued refcount changes to the worker. Retains are sent before
   *  releases so a glyph hidden and re-shown in the same tick never momentarily
   *  drops to zero. */
  private _flushRefs(): void {
    this._refFlushScheduled = false;
    const retain = this._retainQueue;
    const release = this._releaseQueue;
    this._retainQueue = new Map();
    this._releaseQueue = new Map();

    const client = this._client;
    if (!client) return;

    for (const [atlasKey, keys] of retain) {
      if (keys.length > 0)
        client.retainGlyphs(atlasKey, BigUint64Array.from(keys));
    }
    for (const [atlasKey, keys] of release) {
      if (keys.length > 0)
        client.releaseGlyphs(atlasKey, BigUint64Array.from(keys));
    }
  }

  /** Resolve a (font identifier, quality) pair to its qualified atlas key.
   *  Family names get a quality suffix and become their own atlas key; font
   *  URLs are looked up via `_atlasKeys` (already-qualified keys). */
  private _resolveAtlasKey(
    fontIdentifier: string,
    highQuality: boolean,
  ): string {
    if (this._families.has(fontIdentifier))
      return _q(fontIdentifier, highQuality);
    return (
      this._atlasKeys.get(_q(fontIdentifier, highQuality)) ??
      _q(fontIdentifier, highQuality)
    );
  }

  /** Fetch + worker-load a font for a single (url, quality) combination.
   *
   *  `rawUrl` is the network URL (no `#q=...` fragment). `qUrl` and
   *  `qAtlasKey` are the qualified identifiers the worker will use as
   *  FontEntry / atlas keys. The worker side treats `qUrl` as opaque, so the
   *  same `rawUrl` can be loaded twice (once per quality) without collision.
   */
  private async _fetchAndLoad(
    rawUrl: string,
    qUrl: string,
    qAtlasKey: string | undefined,
    highQuality: boolean,
  ): Promise<void> {
    const client = await this._ensureClient();

    const response = await fetch(rawUrl);
    if (!response.ok) {
      throw new Error(
        `FontManager: failed to fetch font from ${rawUrl}: ${response.status}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const result = await client.loadFont(
      qUrl,
      arrayBuffer,
      qAtlasKey,
      highQuality,
    );

    if (!result.ok) {
      throw new Error(`FontManager: WASM failed to load font from ${rawUrl}`);
    }

    // Once per file (quality variants share the same bytes): replace the
    // registered faces' declared unicode ranges with the file's real cmap
    // coverage. An empty result means the cmap was unparsable — keep the
    // declared ranges rather than treating the font as covering nothing.
    if (result.cmapRanges?.length && !this._cmapRanges.has(rawUrl)) {
      this._cmapRanges.set(rawUrl, decodeCmapRanges(result.cmapRanges));
      this._applyCmapRanges(rawUrl);
    }
  }

  private async _flushBatch(): Promise<void> {
    this._batchScheduled = false;

    // Snapshot and clear the queue so new calls during await start a fresh batch
    const queue = this._batchQueue;
    this._batchQueue = new Map();

    let client: FontWorkerClient;
    try {
      client = await this._ensureClient();
    } catch (err) {
      // If we fail to obtain a client, reject all queued entries so their
      // corresponding promises do not remain pending indefinitely.
      for (const [, entries] of queue) {
        for (const entry of entries) {
          entry.reject(err);
        }
      }
      return;
    }

    const processFontBatch = async (
      fontUrl: string,
      entries: {
        text: string;
        cacheKey: string;
        resolve: () => void;
        reject: (reason: unknown) => void;
      }[],
    ) => {
      const texts = entries.map((e) => e.text);

      try {
        const batchResult = await client.prepareTextBatch(fontUrl, texts);
        const atlasKey = batchResult.atlasKey;

        // If the worker evicted glyphs from this atlas, bump its generation so
        // any cached result from before the eviction is treated as stale and
        // re-shaped on next use. Bump before stamping the fresh results below
        // so they carry the new generation.
        if (batchResult.evicted) {
          this._atlasGeneration.set(atlasKey, this._currentGen(atlasKey) + 1);
          // Wake any consumers so they can rebuild visible meshes whose baked
          // metrics this eviction may have invalidated.
          this._scheduleEvictNotify(atlasKey);
        }
        const generation = this._currentGen(atlasKey);

        // Cache each per-text result, stamped with the current generation.
        for (const item of batchResult.results) {
          if (item.shapeResult) {
            item.shapeResult._generation = generation;
            this._shapeCache.get(fontUrl)?.set(item.text, item.shapeResult);
          }
        }

        // Update atlases once for the entire batch, keyed by atlas key
        // (family name for font-family faces, or font URL for standalone fonts)
        if (batchResult.atlas) {
          this._atlasCache.set(atlasKey, batchResult.atlas);
          this._atlasDirty.add(atlasKey);
        }
        if (batchResult.colorAtlas) {
          this._colorAtlasCache.set(atlasKey, batchResult.colorAtlas);
          this._colorAtlasDirty.add(atlasKey);
        }

        for (const entry of entries) {
          entry.resolve();
        }
      } catch (err) {
        for (const entry of entries) {
          entry.reject(err);
        }
      }
    };

    await Promise.all(
      [...queue].map(([fontUrl, entries]) =>
        processFontBatch(fontUrl, entries),
      ),
    );
  }
}
