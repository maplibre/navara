/**
 * Vertical datums the converters take heights in, to heights above
 * the WGS84 ellipsoid.
 */
import type { Grid } from "./grid";
import { sampleRasterDemMostDetailed } from "./rasterDem";
import type { RasterDemTerrain, TerrainPosition } from "./terrain";

// Global, so it also marks instances from another copy of this module, such
// as one a datum module outside an ES module package loads as CommonJS.
const BRAND = Symbol.for("navara.flood.VerticalDatum");

/**
 * Turns heights in a vertical datum into heights above the WGS84 ellipsoid.
 * Subclass it for another datum; the converters take only instances of a
 * subclass, which `VerticalDatum.is` tells apart at run time.
 */
export abstract class VerticalDatum {
  // Private, so that only subclasses have the type.
  declare private readonly nominal: never;
  readonly [BRAND] = true;

  static is(value: unknown): value is VerticalDatum {
    return typeof value === "object" && value !== null && BRAND in value;
  }

  /** Recorded with the converted data. */
  abstract readonly name: string;

  /**
   * The height of this datum's zero above the ellipsoid at each of
   * `positions`, in order: what a height in this datum adds up to an
   * ellipsoidal height with. The converters call it once, with the center
   * of every cell ever wet.
   */
  abstract offsets(
    positions: TerrainPosition[],
  ): ArrayLike<number> | Promise<ArrayLike<number>>;
}

/** Heights already above the WGS84 ellipsoid. */
export class Ellipsoid extends VerticalDatum {
  readonly name = "WGS84 ellipsoid";

  offsets(positions: TerrainPosition[]) {
    return new Float64Array(positions.length);
  }
}

/**
 * Orthometric heights over a geoid given as a `raster-dem` source of its
 * height above the ellipsoid, sampled as the command samples terrain.
 */
export class TileGeoid extends VerticalDatum {
  constructor(
    readonly name: string,
    readonly source: RasterDemTerrain,
  ) {
    super();
  }

  async offsets(positions: TerrainPosition[]) {
    const heights = await sampleRasterDemMostDetailed(this.source, positions);
    return heights.map(({ height }) => height ?? NaN);
  }
}

/** The EGM2008 geoid, as tiles from terrain.reearth.land. */
export class Egm2008Geoid extends TileGeoid {
  constructor() {
    super("EGM2008", {
      type: "raster-dem",
      url: "https://terrain.reearth.land/mapterhorn-egm08/mapbox/geoid/{z}/{x}/{y}.webp",
      elevationDecoder: "mapbox",
      minZoom: 8,
      maxZoom: 8,
    });
  }
}

/**
 * `datum`'s offset at the center of each of `cells` on `grid`, indexed by
 * cell as `cellX`, `cellY` are; NaN at the others.
 */
export const cellOffsets = async (
  datum: VerticalDatum,
  grid: Grid,
  cellX: ArrayLike<number>,
  cellY: ArrayLike<number>,
  cells: Iterable<number>,
): Promise<Float64Array> => {
  const indices = [...new Set(cells)];
  const positions = indices.map((i) => cellCenter(grid, cellX[i], cellY[i]));
  const values = await datum.offsets(positions);
  const offsets = new Float64Array(cellX.length).fill(NaN);
  indices.forEach((i, k) => {
    const offset = values[k];
    if (!Number.isFinite(offset)) {
      const { lng, lat } = positions[k];
      throw new Error(`${datum.name} has no height at ${lng}, ${lat}.`);
    }
    offsets[i] = offset;
  });
  return offsets;
};

/** The center of cell `x`, `y` on `grid`. */
export const cellCenter = (
  grid: Grid,
  x: number,
  y: number,
): TerrainPosition => ({
  lng: (x + 0.5) * grid.lngStep + grid.lngOffset,
  lat: (y + 0.5) * grid.latStep + grid.latOffset,
});
