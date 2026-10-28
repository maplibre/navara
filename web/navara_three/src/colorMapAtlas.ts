import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
} from "three";

import { arraysEqual } from "./utils";

/**
 * Where a layer's color ramp lives in the atlas, as the elevation heatmap
 * shader needs it: the atlas row, its stop count, and whether the stop positions are
 * elevations in meters (`colorStops`) or evenly spaced normalized positions
 * (0..1, mapped through the layer's minHeight/maxHeight).
 */
export type ColorRampRow = {
  row: number;
  stopCount: number;
  /**
   * Whether the layer set `colorStops`: positions are elevations in meters,
   * matched against the raw height. Otherwise they are evenly spaced 0..1,
   * matched against the min/max-normalized height.
   */
  hasColorStops: boolean;
};

type ColorRamp = {
  /** Straight-alpha RGBA, 4 floats per stop. */
  colorMap: Float32Array;
  /** Stop elevations in meters, one per colorMap entry; undefined = evenly spaced. */
  colorStops: Float32Array | undefined;
};

/**
 * Most stops a row keeps. Each stop takes two texels, so the atlas stays within
 * 2048 texels wide, the WebGL2 minimum for MAX_TEXTURE_SIZE. Longer ramps are
 * subsampled like MapLibre's color-relief does (keeping both ends), so one
 * oversized colorMap cannot make the shared texture fail for every layer.
 */
const MAX_RAMP_STOPS = 1024;

/** How many stops a ramp of `entries` colorMap entries occupies in the atlas. */
const rampStopCount = (entries: number): number =>
  // A single entry is padded to two stops (see getTexture).
  Math.min(Math.max(entries, 2), MAX_RAMP_STOPS);

/**
 * Fallback ramp for elevation heatmap layers without their own colorMap:
 * black at minHeight to white at maxHeight, i.e. grayscale.
 */
const DEFAULT_RAMP: ColorRamp = {
  colorMap: new Float32Array([0, 0, 0, 1, 1, 1, 1, 1]),
  colorStops: undefined,
};

/**
 * Manages a 2D texture atlas of elevation heatmap color ramps, one row per
 * layer. Row 0 is always the default (grayscale) ramp.
 *
 * Each stop takes two RGBA32F texels in its row: texel 2i is the stop's color
 * (premultiplied alpha, so the shader interpolates like MapLibre's color ramp)
 * and texel 2i+1 holds the stop's position in its red channel. The shader reads
 * them with texelFetch and binary-searches the positions, so stops may be
 * unevenly spaced and are hit exactly.
 *
 * Row indices shift when ramps are added or removed, so consumers must resolve
 * them via {@link getRow} each time they composite rather than caching them.
 */
export class ColorMapAtlas {
  private ramps = new Map<string, ColorRamp>();
  private texture: DataTexture | null = null;
  private needsRebuild = true;
  // layerId → atlas row, rebuilt lazily after ramps change (queried per
  // elevation heatmap slot on every tile composite).
  private rows: Map<string, number> | null = null;

  /**
   * Register a layer's color ramp. Passing no colorMap (or an empty one)
   * removes it, so the layer falls back to the default ramp.
   * @param layerId - Unique identifier for the layer
   * @param colorMap - Flattened RGBA array [r0,g0,b0,a0, r1,g1,b1,a1, ...]
   * @param colorStops - Optional ascending stop elevations (meters), one per
   *   colorMap entry. Without it the entries are evenly spaced from the
   *   layer's minHeight to maxHeight.
   * @returns Whether the atlas changed (an identical ramp is a no-op)
   */
  setColorMap(
    layerId: string,
    colorMap: Float32Array | undefined,
    colorStops?: Float32Array,
  ): boolean {
    if (!colorMap || colorMap.length === 0) {
      return this.removeColorMap(layerId);
    }
    if (colorMap.length % 4 !== 0) {
      // Most likely a pre-RGBA (flattened RGB) array.
      console.warn(
        `Elevation heatmap layer "${layerId}": colorMap length ${colorMap.length} is not a multiple of 4; ` +
          `expected a flattened RGBA array (ColorMap.flatten()). Falling back to the default colorMap.`,
      );
      return this.removeColorMap(layerId);
    }
    const entries = colorMap.length / 4;
    if (entries > MAX_RAMP_STOPS) {
      console.warn(
        `Elevation heatmap layer "${layerId}": colorMap has ${entries} entries; ` +
          `only ${MAX_RAMP_STOPS} evenly picked ones are used.`,
      );
    }
    const stops = validStops(layerId, entries, colorStops);
    const current = this.ramps.get(layerId);
    if (
      current &&
      arraysEqual(current.colorMap, colorMap) &&
      arraysEqual(current.colorStops, stops)
    ) {
      return false;
    }
    // Copy so later mutation of the caller's arrays cannot desync the atlas.
    this.ramps.set(layerId, {
      colorMap: colorMap.slice(),
      colorStops: stops?.slice(),
    });
    this.needsRebuild = true;
    this.rows = null;
    return true;
  }

  /** The layer's registered colorMap and colorStops, if any. */
  get(
    layerId: string,
  ):
    | { colorMap: Float32Array; colorStops: Float32Array | undefined }
    | undefined {
    return this.ramps.get(layerId);
  }

  /** Whether the layer has its own ramp row. */
  has(layerId: string): boolean {
    return this.ramps.has(layerId);
  }

  /**
   * Remove a layer's ramp from the atlas.
   * @param layerId - Layer identifier to remove
   * @returns Whether the layer had a ramp
   */
  removeColorMap(layerId: string): boolean {
    if (!this.ramps.delete(layerId)) return false;
    this.needsRebuild = true;
    this.rows = null;
    return true;
  }

  /**
   * The layer's ramp location, or the default row's when the layer has no
   * ramp. Rows follow insertion order (Map preserves insertion order).
   * @param layerId - Layer identifier
   */
  getRow(layerId: string | undefined): ColorRampRow {
    if (!this.rows) {
      // Row 0 is the default ramp
      this.rows = new Map(
        Array.from(this.ramps.keys(), (id, index) => [id, index + 1]),
      );
    }
    const row = (layerId !== undefined && this.rows.get(layerId)) || 0;
    const ramp = row === 0 ? DEFAULT_RAMP : this.ramps.get(layerId as string);
    const entries = (ramp ?? DEFAULT_RAMP).colorMap.length / 4;
    return {
      row,
      stopCount: rampStopCount(entries),
      hasColorStops: !!ramp?.colorStops,
    };
  }

  /**
   * Build or rebuild the 2D texture atlas.
   * @returns The DataTexture (always contains at least the default row)
   */
  getTexture(): DataTexture {
    if (!this.needsRebuild && this.texture) {
      return this.texture;
    }

    const ramps = [DEFAULT_RAMP, ...this.ramps.values()];
    let maxStops = 2;
    for (const { colorMap } of ramps) {
      maxStops = Math.max(maxStops, rampStopCount(colorMap.length / 4));
    }
    const width = maxStops * 2; // color texel + position texel per stop

    const data = new Float32Array(width * ramps.length * 4);
    ramps.forEach(({ colorMap, colorStops }, rowIndex) => {
      const n = colorMap.length / 4;
      // Like MapLibre, a single stop becomes two of the same color, 1 apart.
      const stopCount = rampStopCount(n);
      for (let i = 0; i < stopCount; i++) {
        // Source entry for stop i: identity, or an even pick when subsampled.
        const entry =
          n > MAX_RAMP_STOPS
            ? Math.round((i * (n - 1)) / (stopCount - 1))
            : Math.min(i, n - 1);
        const src = entry * 4;
        const a = colorMap[src + 3];
        const colorTexel = (rowIndex * width + i * 2) * 4;
        data[colorTexel] = colorMap[src] * a;
        data[colorTexel + 1] = colorMap[src + 1] * a;
        data[colorTexel + 2] = colorMap[src + 2] * a;
        data[colorTexel + 3] = a;
        data[colorTexel + 4] = colorStops
          ? n === 1
            ? colorStops[0] + i
            : colorStops[entry]
          : n === 1
            ? i
            : entry / (n - 1);
      }
    });

    this.texture?.dispose();
    // Float + nearest, read with texelFetch: positions need full precision
    // (elevations in meters) and nothing is hardware-filtered, so no float
    // filtering extension is involved.
    this.texture = new DataTexture(
      data,
      width,
      ramps.length,
      RGBAFormat,
      FloatType,
    );
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    this.needsRebuild = false;
    return this.texture;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
    this.ramps.clear();
    this.needsRebuild = true;
    this.rows = null;
  }
}

/**
 * `colorStops` if it pairs with `entries` colorMap entries and ascends;
 * otherwise warn and return undefined (evenly spaced).
 */
function validStops(
  layerId: string,
  entries: number,
  colorStops: Float32Array | undefined,
): Float32Array | undefined {
  if (!colorStops) return undefined;
  if (colorStops.length !== entries) {
    console.warn(
      `Elevation heatmap layer "${layerId}": colorStops has ${colorStops.length} values but colorMap has ${entries} entries. ` +
        `Ignoring colorStops (colors are evenly spaced from minHeight to maxHeight).`,
    );
    return undefined;
  }
  for (let i = 1; i < colorStops.length; i++) {
    if (!(colorStops[i] >= colorStops[i - 1])) {
      console.warn(
        `Elevation heatmap layer "${layerId}": colorStops must be in ascending order. ` +
          `Ignoring colorStops (colors are evenly spaced from minHeight to maxHeight).`,
      );
      return undefined;
    }
  }
  return colorStops;
}
