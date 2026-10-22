import { LineDashAtlas as LineDashAtlasImpl } from "@navaramap/engine-api";
import type { DataTexture } from "three";

import { createFloatDataTexture } from "../utils/floatDataTexture";

/**
 * Shape of the ends of a polyline and of its dashes, the value of the
 * polyline material's `cap`. `"round"` adds a half circle one half line width
 * in radius beyond both ends of the line and of every dash, so a zero-length
 * dash becomes a dot. `"square"` extends the ends of the line by half a line
 * width and leaves the dashes' ends square.
 */
export type LineCap = "butt" | "round" | "square";

/**
 * Row every atlas reserves for a solid line with butt ends; `SOLID_DASH_ROW`
 * in `navara_material::line_dash`.
 */
export const SOLID_DASH_ROW = 0;

/**
 * The dash patterns of one view as a texture, shared by every polyline
 * material of that view. The rows and their layout come from
 * `navara_material::line_dash::LineDashAtlas`.
 *
 * @internal
 */
export class LineDashAtlas {
  /** Sampler uniform shared by every material; `.value` is swapped on growth. */
  readonly uniform: { value: DataTexture };

  /** Unset once disposed; a pattern registered after that is drawn solid. */
  private raw?: LineDashAtlasImpl;

  constructor() {
    const raw = new LineDashAtlasImpl();
    this.raw = raw;
    this.uniform = { value: this.createTexture(raw) };
  }

  /**
   * Returns the row holding the pattern of `dashArray` drawn with `cap`,
   * adding it on first use, and holds it until {@link release}. A solid line
   * with butt ends is {@link SOLID_DASH_ROW}.
   */
  register(
    dashArray: readonly number[] | null | undefined,
    cap: LineCap = "butt",
  ): number {
    const raw = this.raw;
    if (!raw) return SOLID_DASH_ROW;

    const capacity = raw.rowCapacity;
    const version = raw.dataVersion;
    const row = raw.register(
      dashArray ? Float32Array.from(dashArray) : undefined,
      cap,
    );
    if (raw.rowCapacity !== capacity) {
      this.uniform.value.dispose();
      this.uniform.value = this.createTexture(raw);
    } else if (raw.dataVersion !== version) {
      (this.uniform.value.image.data as Float32Array).set(raw.data);
      this.uniform.value.needsUpdate = true;
    }
    return row;
  }

  /**
   * Ends one {@link register} of `row`. The last one frees the row for
   * another pattern, so call it only once nothing draws with `row`.
   */
  release(row: number): void {
    this.raw?.release(row);
  }

  dispose(): void {
    this.uniform.value.dispose();
    this.raw?.free();
    this.raw = undefined;
  }

  private createTexture(raw: LineDashAtlasImpl): DataTexture {
    return createFloatDataTexture(
      raw.data.slice(),
      raw.rowTexels,
      raw.rowCapacity,
    );
  }
}
