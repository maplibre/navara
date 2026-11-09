import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

/**
 * Fills in DEM tiles the fixtures lack, as a real DEM server with a full
 * pyramid would serve them.
 *
 * maplibre-gl-js's DEM fixtures cover only the zoom MapLibre loads for each
 * case (e.g. `tiles/12-*.terrain.png` for a z11 view, since a 256 px source
 * loads one level deeper). Navara picks tiles by screen-space error and stops
 * a level shallower on the small test canvases, where every DEM request would
 * 404 and no terrain, hillshade or color-relief would be drawn. A missing tile
 * is stitched from the fixtures below it at their own resolution (a tile one
 * level up is 512 px), so it carries the same DEM pixels; Navara derives texel
 * size from the decoded image, not the source's `tileSize`.
 */

/** `{z}-{x}-{y}` plus the DEM suffix the fixtures use. */
const DEM_TILE = /^(\d+)-(\d+)-(\d+)(\.(?:terrain|terrarium)\.(?:png|webp))$/;
/** How many levels below the requested tile to look for fixtures. */
const MAX_LEVELS = 4;
/** Largest edge, in pixels, of a stitched tile; past it, children are averaged down. */
const MAX_SIZE = 2048;

type Encoding = {
  decode: (r: number, g: number, b: number) => number;
  encode: (height: number, out: Buffer, offset: number) => void;
};

// Mapbox Terrain-RGB: height = -10000 + (R * 65536 + G * 256 + B) * 0.1
const MAPBOX: Encoding = {
  decode: (r, g, b) => -10000 + (r * 65536 + g * 256 + b) * 0.1,
  encode: (height, out, offset) => {
    const v = Math.min(
      Math.max(Math.round((height + 10000) * 10), 0),
      0xffffff,
    );
    out[offset] = (v >> 16) & 0xff;
    out[offset + 1] = (v >> 8) & 0xff;
    out[offset + 2] = v & 0xff;
  },
};

// Terrarium: height = R * 256 + G + B / 256 - 32768
const TERRARIUM: Encoding = {
  decode: (r, g, b) => r * 256 + g + b / 256 - 32768,
  encode: (height, out, offset) => {
    const v = Math.min(Math.max(height + 32768, 0), 65535);
    const whole = Math.floor(v);
    out[offset] = whole >> 8;
    out[offset + 1] = whole & 0xff;
    out[offset + 2] = Math.min(Math.round((v - whole) * 256), 255);
  },
};

/** Whether `file` names a DEM tile this module can build, by its name alone. */
export function isDemTilePath(file: string): boolean {
  return DEM_TILE.test(path.basename(file));
}

const dirListings = new Map<string, Set<string>>();
const built = new Map<string, Promise<Buffer | undefined>>();

/**
 * The DEM tile at `file` stitched from the shallowest level of fixtures below
 * it, or undefined when there are none within MAX_LEVELS. Children the
 * fixtures lack are filled by extending the edge of the ones present.
 */
export function buildDemTileFromChildren(
  file: string,
): Promise<Buffer | undefined> {
  let result = built.get(file);
  if (!result) {
    result = build(file);
    built.set(file, result);
  }
  return result;
}

function listDir(dir: string): Set<string> {
  let names = dirListings.get(dir);
  if (!names) {
    try {
      names = new Set(fs.readdirSync(dir));
    } catch {
      names = new Set();
    }
    dirListings.set(dir, names);
  }
  return names;
}

type Child = { i: number; j: number; file: string };

async function build(file: string): Promise<Buffer | undefined> {
  const match = DEM_TILE.exec(path.basename(file));
  if (!match) return undefined;
  const [z, x, y] = [match[1], match[2], match[3]].map(Number);
  const suffix = match[4];
  const dir = path.dirname(file);
  const fixtures = listDir(dir);

  for (let levels = 1; levels <= MAX_LEVELS; levels++) {
    const n = 1 << levels;
    const children: Child[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const name = `${z + levels}-${x * n + i}-${y * n + j}${suffix}`;
        if (fixtures.has(name)) {
          children.push({ i, j, file: path.join(dir, name) });
        }
      }
    }
    if (children.length > 0) {
      const encoding = suffix.includes("terrarium") ? TERRARIUM : MAPBOX;
      return stitch(children, n, encoding, suffix.endsWith(".webp"));
    }
  }
  return undefined;
}

async function stitch(
  children: Child[],
  n: number,
  encoding: Encoding,
  webp: boolean,
): Promise<Buffer | undefined> {
  const images = await Promise.all(
    children.map(async (child) => {
      const { data, info } = await sharp(child.file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { ...child, data, width: info.width, height: info.height };
    }),
  );
  const childSize = images[0].width;
  if (
    images.some((img) => img.width !== childSize || img.height !== childSize)
  ) {
    return undefined;
  }
  // Keep the children's resolution up to MAX_SIZE; past it, average
  // `factor` x `factor` blocks of child pixels.
  let scale = 1;
  while (scale < n && childSize * scale * 2 <= MAX_SIZE) scale *= 2;
  const factor = n / scale;
  if (childSize % factor !== 0) return undefined;
  const size = childSize * scale;
  // Output pixels per child along each axis.
  const cell = childSize / factor;

  const heights = new Float64Array(size * size).fill(NaN);
  for (const img of images) {
    for (let oy = 0; oy < cell; oy++) {
      for (let ox = 0; ox < cell; ox++) {
        let sum = 0;
        for (let by = 0; by < factor; by++) {
          for (let bx = 0; bx < factor; bx++) {
            const p = ((oy * factor + by) * childSize + (ox * factor + bx)) * 4;
            sum += encoding.decode(
              img.data[p],
              img.data[p + 1],
              img.data[p + 2],
            );
          }
        }
        heights[(img.j * cell + oy) * size + img.i * cell + ox] =
          sum / (factor * factor);
      }
    }
  }

  // Outside the children present, extend their edge (clamping into their
  // bounding box) so no artificial cliff shades the visible area; holes inside
  // the box take the mean height.
  const minX = Math.min(...images.map((img) => img.i)) * cell;
  const maxX = (Math.max(...images.map((img) => img.i)) + 1) * cell - 1;
  const minY = Math.min(...images.map((img) => img.j)) * cell;
  const maxY = (Math.max(...images.map((img) => img.j)) + 1) * cell - 1;
  let total = 0;
  let count = 0;
  for (const h of heights) {
    if (!Number.isNaN(h)) {
      total += h;
      count++;
    }
  }
  const mean = total / count;

  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    const cy = Math.min(Math.max(py, minY), maxY);
    for (let px = 0; px < size; px++) {
      const cx = Math.min(Math.max(px, minX), maxX);
      const h = heights[cy * size + cx];
      const offset = (py * size + px) * 4;
      encoding.encode(Number.isNaN(h) ? mean : h, out, offset);
      out[offset + 3] = 255;
    }
  }

  const image = sharp(out, { raw: { width: size, height: size, channels: 4 } });
  return (webp ? image.webp({ lossless: true }) : image.png()).toBuffer();
}
