import {
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

/**
 * Sub-rectangle of the atlas in pixels. Row 0 is the bottom of the texture
 * (v = 0), matching the flipY applied at decode time. Rects are stored in
 * pixel space and normalized by `uAtlasSize` in the shader, so they stay
 * valid when the atlas grows.
 */
export type AtlasRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The image's pixels per CSS pixel (see {@link AtlasImage.pixelRatio}). */
  pixelRatio: number;
  /** See {@link AtlasImage.sdf}. */
  sdf: boolean;
};

type PixelRect = Omit<AtlasRect, "pixelRatio" | "sdf">;

export type AtlasImage = {
  width: number;
  height: number;
  /** RGBA, tightly packed, row 0 = bottom of the image (flipY at decode). */
  data: Uint8Array;
  /** Image pixels per CSS pixel, as a sprite's `@2x` icons have 2. Divides
   *  the image's pixel size under `sizeRelativeToImage`. Defaults to 1. */
  pixelRatio?: number;
  /** Whether the alpha holds a signed distance field (a sprite's `"sdf":
   *  true` icons): 0.75 at the shape's edge, more inside, as MapLibre
   *  encodes it. RGB is ignored and the shape is drawn in the material's
   *  color. Defaults to false. */
  sdf?: boolean;
};

export type LoadAtlasImage = (url: string) => Promise<AtlasImage>;
type LoadAtlasImageOrNone = (url: string) => Promise<AtlasImage | undefined>;

export type BillboardAtlasOptions = {
  initialSize?: number;
  maxSize?: number;
  /**
   * How to fetch and decode a URL into RGBA pixels. Kept injectable (and out
   * of this module) so the atlas has no browser/worker dependencies — use
   * `loadAtlasImageFromUrl` from `billboardAtlasImageLoader` in the app.
   */
  loadImage: LoadAtlasImage;
};

/** Spacing between entries so LinearFilter sampling never bleeds neighbors. */
const GUTTER = 1;
const DEFAULT_INITIAL_SIZE = 256;
// Conservative floor of WebGL2 MAX_TEXTURE_SIZE across devices.
const DEFAULT_MAX_SIZE = 4096;

type Shelf = {
  y: number;
  height: number;
  /** Horizontal cursor: next free x within this shelf. */
  x: number;
};

/**
 * A texture atlas for billboard images: packs arbitrarily sized images into a
 * single square RGBA `DataTexture` with a shelf allocator, deduplicating loads
 * by URL (including in-flight ones — the promise itself is cached).
 *
 * The atlas grows by doubling up to `maxSize`. Growth preserves the layout, so
 * previously returned rects remain valid; only the texture object is replaced
 * (a `DataTexture` cannot be resized in place). Callers must re-read `texture`
 * and `size` after every `pack()` and re-sync their uniforms.
 *
 * Failed loads are cached as `undefined` so a bad URL shared by many features
 * is fetched once, not once per feature.
 */
export class BillboardAtlas {
  private _size: number;
  private readonly _maxSize: number;
  private _data: Uint8Array;
  private _texture: DataTexture;
  private _shelves: Shelf[] = [];
  private _nextShelfY = 0;
  private readonly _rects = new Map<string, Promise<AtlasRect | undefined>>();
  private readonly _loadImage: LoadAtlasImage;

  constructor(options: BillboardAtlasOptions) {
    this._size = options.initialSize ?? DEFAULT_INITIAL_SIZE;
    this._maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this._loadImage = options.loadImage;
    this._data = new Uint8Array(this._size * this._size * 4);
    this._texture = this._createTexture();
  }

  get texture(): DataTexture {
    return this._texture;
  }

  /** Current atlas edge length in pixels (the atlas is always square). */
  get size(): number {
    return this._size;
  }

  /**
   * Memory footprint of the atlas in bytes: the CPU pixel buffer (kept
   * resident for growth re-blits and `needsUpdate` re-uploads) plus the
   * equal-sized GPU copy held by the `DataTexture` (RGBA8, no mipmaps).
   */
  get byteLength(): number {
    return this._data.byteLength * 2;
  }

  /**
   * Load `url` (once) and pack it into the atlas. `load` replaces the
   * atlas's `loadImage` for an image that is not fetched by URL; `url` is
   * then just its cache key, and `load` resolving to `undefined` means there
   * is no image (reported by `load`, not here).
   * Resolves to the entry's pixel rect, or `undefined` when the image fails
   * to load or the atlas is full even at `maxSize`.
   */
  pack(
    url: string,
    load: LoadAtlasImageOrNone = this._loadImage,
  ): Promise<AtlasRect | undefined> {
    const cached = this._rects.get(url);
    if (cached) return cached;

    const pending = this._loadAndPack(url, load).catch((error) => {
      console.warn(`BillboardAtlas: failed to load image "${url}"`, error);
      return undefined;
    });
    this._rects.set(url, pending);
    return pending;
  }

  dispose(): void {
    this._texture.dispose();
    this._rects.clear();
    this._shelves = [];
  }

  private async _loadAndPack(
    url: string,
    load: LoadAtlasImageOrNone,
  ): Promise<AtlasRect | undefined> {
    const image = await load(url);
    if (!image) return undefined;
    const rect = this._allocate(image.width, image.height);
    if (!rect) {
      console.warn(
        `BillboardAtlas: no space for "${url}" (${image.width}x${image.height}) at max atlas size ${this._maxSize}`,
      );
      return undefined;
    }
    this._blit(image, rect);
    return {
      ...rect,
      pixelRatio: image.pixelRatio ?? 1,
      sdf: image.sdf ?? false,
    };
  }

  private _allocate(w: number, h: number): PixelRect | undefined {
    for (;;) {
      const rect = this._tryAllocate(w, h);
      if (rect) return rect;
      if (!this._grow()) return undefined;
    }
  }

  private _tryAllocate(w: number, h: number): PixelRect | undefined {
    const needW = w + GUTTER;
    const needH = h + GUTTER;
    if (needW > this._size) return undefined;

    // Best-fit shelf: the shortest existing shelf that still fits the entry.
    let best: Shelf | undefined;
    for (const shelf of this._shelves) {
      if (needH > shelf.height || shelf.x + needW > this._size) continue;
      if (!best || shelf.height < best.height) best = shelf;
    }

    if (!best && this._nextShelfY + needH <= this._size) {
      best = { y: this._nextShelfY, height: needH, x: 0 };
      this._shelves.push(best);
      this._nextShelfY += needH;
    }
    if (!best) return undefined;

    const rect = { x: best.x, y: best.y, w, h };
    best.x += needW;
    return rect;
  }

  /**
   * Double the atlas edge, preserving the existing layout: old pixel rows are
   * copied into the wider buffer, shelves keep their y/height and simply gain
   * free space to the right, and new shelves can open below `_nextShelfY`.
   */
  private _grow(): boolean {
    const newSize = this._size * 2;
    if (newSize > this._maxSize) return false;

    const newData = new Uint8Array(newSize * newSize * 4);
    for (let row = 0; row < this._size; row++) {
      newData.set(
        this._data.subarray(row * this._size * 4, (row + 1) * this._size * 4),
        row * newSize * 4,
      );
    }

    this._size = newSize;
    this._data = newData;
    this._texture.dispose();
    this._texture = this._createTexture();
    return true;
  }

  private _blit(image: AtlasImage, rect: PixelRect): void {
    for (let row = 0; row < rect.h; row++) {
      this._data.set(
        image.data.subarray(row * rect.w * 4, (row + 1) * rect.w * 4),
        ((rect.y + row) * this._size + rect.x) * 4,
      );
    }
    this._texture.needsUpdate = true;
  }

  private _createTexture(): DataTexture {
    const texture = new DataTexture(this._data, this._size, this._size);
    texture.format = RGBAFormat;
    texture.type = UnsignedByteType;
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }
}
