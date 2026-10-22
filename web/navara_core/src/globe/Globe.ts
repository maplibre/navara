import type { Globe as GlobeWasm } from "@navaramap/engine";

import { Color } from "../color";
import type { RemoveFreeRecursively } from "../types";
/**
 * Handler for accessing individual Globe properties from WASM.
 * This provides a reference-based interface instead of copying the entire Globe object.
 */
export type GlobeHandler = {
  getTransparent: () => boolean | undefined;
  getMaxSse: () => number | undefined;
  getSegments: () => number | undefined;
  getColor: () => Color | undefined;
  getHideUnderground: () => boolean | undefined;
  getUseNormal: () => boolean | undefined;
  getOpacity: () => number | undefined;
  getWireframe: () => boolean | undefined;
  setTransparent: (value: boolean) => void;
  setMaxSse: (value: number) => void;
  setSegments: (value: number) => void;
  setColor: (value: Color) => void;
  setHideUnderground: (value: boolean) => void;
  setUseNormal: (value: boolean) => void;
  setOpacity: (value: number) => void;
  setWireframe: (value: boolean) => void;
};

// `isGeographicTiling` is engine-set output (the tiling scheme is dictated by
// the terrain source, not configurable), so it is excluded from both the
// options and the wrapper below.
export type GlobeOptions = Partial<
  Omit<GlobeWasm, "constructor" | "free" | "color" | "isGeographicTiling">
> & {
  color?: Color;
};

/**
 * Globe configuration manager.
 *
 * Provides an interface for accessing and modifying globe properties
 * that are shared across different material types (VectorTile, RasterTile, RasterTerrain).
 */
export class Globe implements Omit<
  RemoveFreeRecursively<GlobeWasm>,
  "color" | "isGeographicTiling"
> {
  private handler: GlobeHandler;

  constructor(handler: GlobeHandler, options?: GlobeOptions) {
    this.handler = handler;
    this.setOptions(options);
  }

  setOptions(options?: GlobeOptions) {
    if (options?.maxSse != null) {
      this.maxSse = options.maxSse;
    }
    if (options?.segments != null) {
      this.segments = options.segments;
    }
    if (options?.color != null) {
      this.color = options.color;
    }
    if (options?.hideUnderground != null) {
      this.hideUnderground = options.hideUnderground;
    }
    if (options?.useNormal != null) {
      this.useNormal = options.useNormal;
    }
    if (options?.transparent != null) {
      this.transparent = options.transparent;
    }
    if (options?.opacity != null) {
      this.opacity = options.opacity;
    }
    if (options?.wireframe != null) {
      this.wireframe = options.wireframe;
    }
  }

  get maxSse(): number {
    return this.handler.getMaxSse() ?? 2.0;
  }

  set maxSse(value: number) {
    this.handler.setMaxSse(value);
  }

  get segments(): number {
    return this.handler.getSegments() ?? 64;
  }
  set segments(value: number) {
    this.handler.setSegments(value);
  }

  get color(): Color | undefined {
    return this.handler.getColor();
  }

  set color(value: Color) {
    this.handler.setColor(value);
  }

  get hideUnderground(): boolean {
    return this.handler.getHideUnderground() ?? true;
  }

  set hideUnderground(value: boolean) {
    this.handler.setHideUnderground(value);
  }

  get useNormal(): boolean {
    return this.handler.getUseNormal() ?? false;
  }

  set useNormal(value: boolean) {
    this.handler.setUseNormal(value);
  }

  get transparent(): boolean {
    return this.handler.getTransparent() ?? false;
  }

  set transparent(value: boolean) {
    this.handler.setTransparent(value);
  }

  get opacity(): number {
    return this.handler.getOpacity() ?? 1.0;
  }

  set opacity(value: number) {
    this.handler.setOpacity(value);
  }

  get wireframe(): boolean {
    return this.handler.getWireframe() ?? false;
  }

  set wireframe(value: boolean) {
    this.handler.setWireframe(value);
  }
}
