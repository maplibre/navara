/**
 * Projections the point converter takes coordinates in, to degrees.
 */

/** Turns projected coordinates in meters into degrees. */
export type Projection = {
  /** Recorded with the converted data. */
  readonly name: string;
  /** Longitude and latitude in degrees of easting `x` and northing `y`. */
  toGeographic(x: number, y: number): [lng: number, lat: number];
};

// Origins of the zones, latitude and longitude in degrees.
const ZONE_ORIGINS: [number, number][] = [
  [33, 129 + 30 / 60],
  [33, 131],
  [36, 132 + 10 / 60],
  [33, 133 + 30 / 60],
  [36, 134 + 20 / 60],
  [36, 136],
  [36, 137 + 10 / 60],
  [36, 138 + 30 / 60],
  [36, 139 + 50 / 60],
  [40, 140 + 50 / 60],
  [44, 140 + 15 / 60],
  [44, 142 + 15 / 60],
  [44, 144 + 15 / 60],
  [26, 142],
  [26, 127 + 30 / 60],
  [26, 124],
  [26, 131],
  [20, 136],
  [26, 154],
];

/** EPSG code of zone 1 of JGD2011; zone `n` is this plus `n - 1`. */
export const PLANE_RECTANGULAR_EPSG = 6669;

// GRS80, and the scale on the central meridian.
const A = 6378137;
const F = 1 / 298.257222101;
const SCALE = 0.9999;

/**
 * The Japan Plane Rectangular Coordinate System of JGD2011, zones 1 to 19
 * (EPSG:6669 to EPSG:6687): a transverse Mercator projection of GRS80,
 * inverted with Krüger's series to the sixth order (Kawase 2011), well within
 * a millimeter in Japan.
 */
export class PlaneRectangular implements Projection {
  readonly name: string;
  readonly #lng0: number;
  readonly #scale: number;
  readonly #x0: number;
  readonly #beta: number[];
  readonly #delta: number[];

  constructor(readonly zone: number) {
    const origin = ZONE_ORIGINS[zone - 1];
    if (!Number.isInteger(zone) || !origin) {
      throw new Error(`Zone ${zone} is not a plane rectangular zone (1-19).`);
    }
    this.name = `JGD2011 / Japan Plane Rectangular CS ${zone} (EPSG:${PLANE_RECTANGULAR_EPSG + zone - 1})`;
    const n = F / (2 - F);
    const n2 = n * n;
    const n3 = n2 * n;
    const n4 = n3 * n;
    const n5 = n4 * n;
    const n6 = n5 * n;
    const alpha = [
      1 + n2 / 4 + n4 / 64,
      (-3 / 2) * (n - n3 / 8 - n5 / 64),
      (15 / 16) * (n2 - n4 / 4),
      (-35 / 48) * (n3 - (5 / 16) * n5),
      (315 / 512) * n4,
      (-693 / 1280) * n5,
    ];
    this.#beta = [
      n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512,
      n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105,
      (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480,
      (4397 * n4) / 161280 - (11 * n5) / 504,
      (4583 * n5) / 161280,
    ];
    this.#delta = [
      2 * n -
        (2 * n2) / 3 -
        2 * n3 +
        (116 * n4) / 45 +
        (26 * n5) / 45 -
        (2854 * n6) / 675,
      (7 * n2) / 3 -
        (8 * n3) / 5 -
        (227 * n4) / 45 +
        (2704 * n5) / 315 +
        (2323 * n6) / 945,
      (56 * n3) / 15 -
        (136 * n4) / 35 -
        (1262 * n5) / 105 +
        (73814 * n6) / 2835,
      (4279 * n4) / 630 - (332 * n5) / 35 - (399572 * n6) / 14175,
      (4174 * n5) / 315 - (144838 * n6) / 6237,
      (601676 * n6) / 22275,
    ];
    const [lat0, lng0] = origin;
    const phi0 = (lat0 * Math.PI) / 180;
    const k = (SCALE * A) / (1 + n);
    this.#scale = k * alpha[0];
    // The meridian arc from the equator to the origin.
    let arc = alpha[0] * phi0;
    for (let j = 1; j <= 5; j++) arc += alpha[j] * Math.sin(2 * j * phi0);
    this.#x0 = k * arc;
    this.#lng0 = lng0;
  }

  toGeographic(x: number, y: number): [lng: number, lat: number] {
    const xi = (y + this.#x0) / this.#scale;
    const eta = x / this.#scale;
    let xi1 = xi;
    let eta1 = eta;
    for (let j = 1; j <= 5; j++) {
      const b = this.#beta[j - 1];
      xi1 -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      eta1 -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
    let phi = chi;
    for (let j = 1; j <= 6; j++) {
      phi += this.#delta[j - 1] * Math.sin(2 * j * chi);
    }
    const lambda = Math.atan2(Math.sinh(eta1), Math.cos(xi1));
    return [this.#lng0 + (lambda * 180) / Math.PI, (phi * 180) / Math.PI];
  }
}

/** The plane rectangular zone of an EPSG code such as `"EPSG:6677"`. */
export const planeRectangularOf = (code: string) => {
  const match = /^EPSG:(\d+)$/i.exec(code.trim());
  const zone = match ? Number(match[1]) - PLANE_RECTANGULAR_EPSG + 1 : NaN;
  return zone >= 1 && zone <= 19 ? new PlaneRectangular(zone) : undefined;
};
