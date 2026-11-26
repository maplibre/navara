import type { AtlasImage } from "./billboardAtlas";

/** One icon sheet of a billboard material's `sprite`. */
export type SpriteSheetRef = { readonly id: string; readonly url: string };

/** An icon cut out of its sheet, and the sheet's pixels per CSS pixel. */
export type SpriteIcon = AtlasImage & { pixelRatio: number };

/** A sheet's index (`<url>.json`) and its decoded image (`<url>.png`). */
export type SpriteSheetData = { index: unknown; image: AtlasImage };

export type LoadSpriteSheet = (urls: {
  json: string;
  image: string;
}) => Promise<SpriteSheetData>;

type SpriteRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio: number;
};

/**
 * The index and image URLs of a sheet: `@2x` and the extension go after the
 * path, ahead of any query string or fragment (`/sprite?k=1` →
 * `/sprite@2x.json?k=1`), as MapLibre does.
 */
export function spriteSheetUrls(
  url: string,
  highDpi: boolean,
): { json: string; image: string } {
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  const rest = end === -1 ? "" : url.slice(end);
  const base = path + (highDpi ? "@2x" : "");
  return { json: `${base}.json${rest}`, image: `${base}.png${rest}` };
}

const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const isCoordinate = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

/** An index entry whose rect lies inside a `width` × `height` sheet. */
function toSpriteRect(
  value: unknown,
  width: number,
  height: number,
): SpriteRect | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  const { x, y, width: w, height: h } = entry;
  const pixelRatio = entry.pixelRatio ?? 1;
  if (
    !isCoordinate(x) ||
    !isCoordinate(y) ||
    !isPositive(w) ||
    !isPositive(h) ||
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    !isPositive(pixelRatio) ||
    x + w > width ||
    y + h > height
  ) {
    return undefined;
  }
  return { x, y, width: w, height: h, pixelRatio };
}

/**
 * Copy `rect` (top-down sheet coordinates) out of `sheet`, whose row 0 is the
 * bottom of the image, keeping that row order.
 */
function cutIcon(sheet: AtlasImage, rect: SpriteRect): AtlasImage {
  const { x, y, width, height } = rect;
  const data = new Uint8Array(width * height * 4);
  const bottom = sheet.height - y - height;
  for (let row = 0; row < height; row++) {
    const start = ((bottom + row) * sheet.width + x) * 4;
    data.set(sheet.data.subarray(start, start + width * 4), row * width * 4);
  }
  return { width, height, data };
}

type IconEntry = { sheet: AtlasImage; rect: SpriteRect; icon?: SpriteIcon };

/** The icons of a loaded sprite, cut out of their sheet on first use. */
export class SpriteIcons {
  constructor(private readonly _entries: ReadonlyMap<string, IconEntry>) {}

  get(name: string): SpriteIcon | undefined {
    const entry = this._entries.get(name);
    if (!entry) return undefined;
    entry.icon ??= {
      ...cutIcon(entry.sheet, entry.rect),
      pixelRatio: entry.rect.pixelRatio,
    };
    return entry.icon;
  }
}

/**
 * Loads each distinct `sprite` once per view, as MapLibre's `loadSprite`
 * does: the `@2x` sheets are used when the pixel ratio is above 1 (with no
 * fallback to `1x`), identical `id` + `url` entries load once, and icons are
 * named `<id>:<name>`, except those of the sheet with id `"default"`. If any
 * sheet fails to load, a warning is logged and the sprite has no icons.
 */
export class SpriteCache {
  private readonly _sprites = new Map<string, Promise<SpriteIcons>>();
  /** Sheets by URL: sprites naming the same sheet with other ids share it. */
  private readonly _sheets = new Map<string, Promise<SpriteSheetData>>();

  constructor(private readonly _loadSheet: LoadSpriteSheet) {}

  get(
    sheets: readonly SpriteSheetRef[],
    pixelRatio: number,
  ): Promise<SpriteIcons> {
    const highDpi = pixelRatio > 1;
    const unique = [
      ...new Map(sheets.map((s) => [`${s.id}\0${s.url}`, s])).values(),
    ];
    const key = JSON.stringify([highDpi, unique.map((s) => [s.id, s.url])]);
    let sprite = this._sprites.get(key);
    if (!sprite) {
      sprite = this._load(unique, highDpi);
      this._sprites.set(key, sprite);
    }
    return sprite;
  }

  private async _load(
    sheets: readonly SpriteSheetRef[],
    highDpi: boolean,
  ): Promise<SpriteIcons> {
    const results = await Promise.allSettled(
      sheets.map((s) => this._sheet(s.url, highDpi)),
    );
    const entries = new Map<string, IconEntry>();
    let failed = false;
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        failed = true;
        console.warn(
          `Failed to load sprite "${sheets[i].url}":`,
          result.reason,
        );
        return;
      }
      const { index, image } = result.value;
      if (!index || typeof index !== "object") return;
      const prefix = sheets[i].id === "default" ? "" : `${sheets[i].id}:`;
      for (const [name, value] of Object.entries(index)) {
        const rect = toSpriteRect(value, image.width, image.height);
        if (rect) entries.set(prefix + name, { sheet: image, rect });
      }
    });
    return new SpriteIcons(failed ? new Map() : entries);
  }

  private _sheet(url: string, highDpi: boolean): Promise<SpriteSheetData> {
    const urls = spriteSheetUrls(url, highDpi);
    let sheet = this._sheets.get(urls.json);
    if (!sheet) {
      sheet = this._loadSheet(urls);
      this._sheets.set(urls.json, sheet);
    }
    return sheet;
  }
}
