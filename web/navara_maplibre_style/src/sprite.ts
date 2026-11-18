/**
 * Loads a MapLibre Style `sprite`. As in MapLibre, each sheet is decoded once
 * and an icon is cut out of it only when first used. Navara billboards load
 * their images by URL, and the lookup runs inside synchronous feature
 * evaluation, so a cut icon becomes a data URL.
 */
import type { SpriteSpecification } from "@maplibre/maplibre-gl-style-spec";

/** One icon of the sprite: its own image URL and the sheet's pixel ratio. */
export type SpriteImage = { url: string; pixelRatio: number };

/** Icons by the name `icon-image` refers to them with. */
export type SpriteImages = { get(name: string): SpriteImage | undefined };

/** An entry of a sprite index file (`<url>.json`). */
export type SpriteRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio: number;
};

/**
 * The index and sheet URLs of a sprite: `@2x` and the extension go after the
 * path, ahead of any query string or fragment (`/sprite?k=1` →
 * `/sprite@2x.json?k=1`). The URL is not parsed or checked: an absolute URL or
 * an origin-relative path (`/path/to/sprite`) goes to `fetch` as is. A path
 * like `../sprite` is not resolved against the style's URL.
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

const isPositive = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/** An index entry with a non-empty rect; `pixelRatio` may be omitted. */
function isSpriteRect(
  value: unknown,
): value is Omit<SpriteRect, "pixelRatio"> & { pixelRatio?: number } {
  if (!value || typeof value !== "object") return false;
  const { x, y, width, height, pixelRatio } = value as Record<string, unknown>;
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    isPositive(width) &&
    isPositive(height) &&
    (pixelRatio === undefined || isPositive(pixelRatio))
  );
}

/**
 * The image an `icon-image` name refers to. With a sprite, only its icons
 * exist, as in MapLibre: a missing name (or a sprite still loading or failed
 * to load) has none. Without one, Navara reads the name as an image URL.
 */
export function resolveIconImage(
  name: string,
  sprite: SpriteImages | undefined,
): SpriteImage | undefined {
  return sprite ? sprite.get(name) : { url: name, pixelRatio: 1 };
}

/** Reused for every cut: cuts run one at a time, synchronously. */
let scratch: HTMLCanvasElement | undefined;

/** A PNG data URL of `rect` of `sheet`; `toDataURL` is synchronous. */
function cutIcon(sheet: ImageBitmap, rect: SpriteRect): string {
  scratch ??= document.createElement("canvas");
  // Setting the size also clears the canvas.
  scratch.width = rect.width;
  scratch.height = rect.height;
  const ctx = scratch.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable");
  const { x, y, width, height } = rect;
  ctx.drawImage(sheet, x, y, width, height, 0, 0, width, height);
  return scratch.toDataURL("image/png");
}

type SpriteIcon = { sheet: ImageBitmap; rect: SpriteRect; image?: SpriteImage };

/** Cuts an icon out of its sheet the first time it is asked for. */
class LazySpriteImages implements SpriteImages {
  constructor(private readonly icons: ReadonlyMap<string, SpriteIcon>) {}

  get(name: string): SpriteImage | undefined {
    const icon = this.icons.get(name);
    if (!icon) return undefined;
    icon.image ??= {
      url: cutIcon(icon.sheet, icon.rect),
      pixelRatio: icon.rect.pixelRatio,
    };
    return icon.image;
  }
}

async function fetchSheet(
  url: string,
  highDpi: boolean,
): Promise<{ index: Record<string, unknown>; sheet: ImageBitmap }> {
  const urls = spriteSheetUrls(url, highDpi);
  const [indexResponse, imageResponse] = await Promise.all([
    fetch(urls.json),
    fetch(urls.image),
  ]);
  for (const [response, target] of [
    [indexResponse, urls.json],
    [imageResponse, urls.image],
  ] as const) {
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${target}: ${response.status} ${response.statusText}`,
      );
    }
  }
  return {
    index: (await indexResponse.json()) as Record<string, unknown>,
    sheet: await createImageBitmap(await imageResponse.blob()),
  };
}

/**
 * Load every sprite of the style, as MapLibre's `loadSprite` does: the `@2x`
 * sheet is used when `pixelRatio > 1` (with no fallback to `1x`), identical
 * `id` + `url` entries load once, and icons are named `<id>:<name>`, except
 * those of the sprite whose id is `default`. The sprites load together: if any
 * fails, a warning is logged for each failure and none of them is used.
 */
export async function loadSprite(
  sprite: SpriteSpecification,
  pixelRatio: number,
): Promise<SpriteImages> {
  const entries =
    typeof sprite === "string" ? [{ id: "default", url: sprite }] : sprite;
  const seen = new Set<string>();
  const unique = entries.filter(({ id, url }) => {
    const key = `${id}${url}`;
    return !seen.has(key) && seen.add(key);
  });
  const highDpi = pixelRatio > 1;

  const results = await Promise.allSettled(
    unique.map(async ({ id, url }) => {
      const { index, sheet } = await fetchSheet(url, highDpi);
      const prefix = id === "default" ? "" : `${id}:`;
      return Object.entries(index).flatMap(([name, rect]) =>
        isSpriteRect(rect)
          ? [
              [
                prefix + name,
                { sheet, rect: { ...rect, pixelRatio: rect.pixelRatio ?? 1 } },
              ] as const,
            ]
          : [],
      );
    }),
  );

  const failures = results.flatMap((r, i) =>
    r.status === "rejected" ? [{ url: unique[i].url, reason: r.reason }] : [],
  );
  for (const { url, reason } of failures) {
    console.warn(`Failed to load sprite "${url}":`, reason);
  }
  return new LazySpriteImages(
    new Map(
      failures.length > 0
        ? []
        : results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    ),
  );
}
