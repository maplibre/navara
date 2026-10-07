import {
  geodeticToVector3,
  vector3ToGeodetic,
  type LatLngHeight,
  type XYZ,
} from "@navaramap/three";
import type { LineString, Polygon, Position } from "geojson";
import { Matrix4, Vector3 } from "three";

/**
 * Position input for the standalone polygon and polyline meshes, in the
 * mesh's local space: geodetic input is local ECEF. The geometry builder
 * needs globe coordinates, so the mesh transform is applied at build time and
 * the mesh object itself stays at identity.
 */

/** Geographic positions: lng/lat in degrees, height in metres. */
export type GeodeticPositions = readonly LatLngHeight[];

/** Cartesian positions in metres; ECEF without a mesh transform. */
export type CartesianPositions = readonly XYZ[];

/** Rings of a polygon: the outer ring first, then holes. */
export type GeodeticRings = GeodeticPositions | readonly GeodeticPositions[];
export type CartesianRings = CartesianPositions | readonly CartesianPositions[];

/** Flat `[x, y, z, ...]` positions plus how the builder should read them. */
export type BuiltPositions = {
  /** One entry per ring; a polyline has one. */
  rings: Float64Array[];
  /** True when the values are ECEF metres rather than lng/lat degrees. */
  geocentric: boolean;
};

export type PositionSource = {
  positions?: GeodeticRings;
  points?: CartesianRings;
  geojson?: Polygon | LineString;
};

/** Mutually exclusive position sources; a change rebuilds the geometry. */
export const POSITION_KEYS = ["positions", "points", "geojson"] as const;

function isRingList<T>(
  value: readonly T[] | readonly (readonly T[])[],
): value is readonly (readonly T[])[] {
  return Array.isArray(value[0]);
}

/** Normalizes the "one ring or several" shorthand into a ring list. */
function toRings<T>(
  value: readonly T[] | readonly (readonly T[])[],
): readonly (readonly T[])[] {
  if (value.length === 0) return [];
  return isRingList(value) ? value : [value];
}

const IDENTITY = new Matrix4();
const TRANSFORMED = new Vector3();

function packGeodetic(ring: readonly LatLngHeight[]): Float64Array {
  const out = new Float64Array(ring.length * 3);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    out[i * 3] = p.lng;
    out[i * 3 + 1] = p.lat;
    out[i * 3 + 2] = p.height;
  }
  return out;
}

function packCartesian(
  ring: readonly XYZ[],
  transform: Matrix4 | undefined,
): Float64Array {
  const out = new Float64Array(ring.length * 3);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (transform) {
      TRANSFORMED.set(p.x, p.y, p.z).applyMatrix4(transform);
      out[i * 3] = TRANSFORMED.x;
      out[i * 3 + 1] = TRANSFORMED.y;
      out[i * 3 + 2] = TRANSFORMED.z;
    } else {
      out[i * 3] = p.x;
      out[i * 3 + 1] = p.y;
      out[i * 3 + 2] = p.z;
    }
  }
  return out;
}

function geoJsonRing(ring: readonly Position[]): LatLngHeight[] {
  return ring.map(([lng, lat, height]) => ({ lng, lat, height: height ?? 0 }));
}

/** Geodetic rings, or with a transform, their ECEF positions transformed. */
function packGeodeticRings(
  rings: readonly (readonly LatLngHeight[])[],
  transform: Matrix4 | undefined,
): BuiltPositions {
  if (!transform) {
    return { rings: rings.map(packGeodetic), geocentric: false };
  }
  return {
    rings: rings.map((ring) =>
      packCartesian(ring.map(geodeticToVector3), transform),
    ),
    geocentric: true,
  };
}

/**
 * Packs `positions`, `points` or `geojson` into flat buffers, with
 * `transform` (the mesh's local-to-world matrix) applied. Geodetic input
 * stays geodetic under an identity transform.
 *
 * @throws When none or more than one of them is set.
 */
export function buildPositions(
  source: PositionSource,
  transform: Matrix4 = IDENTITY,
): BuiltPositions {
  const applied = transform.equals(IDENTITY) ? undefined : transform;
  const given = [
    source.positions !== undefined,
    source.points !== undefined,
    source.geojson !== undefined,
  ].filter(Boolean).length;
  if (given !== 1) {
    throw new Error(
      "Set exactly one of `positions` (geodetic), `points` (cartesian) or `geojson`",
    );
  }

  if (source.positions !== undefined) {
    return packGeodeticRings(toRings(source.positions), applied);
  }
  if (source.points !== undefined) {
    return {
      rings: toRings(source.points).map((ring) => packCartesian(ring, applied)),
      geocentric: true,
    };
  }

  const geometry = source.geojson;
  if (geometry === undefined) {
    throw new Error("unreachable: geojson is set");
  }
  const rings =
    geometry.type === "Polygon"
      ? geometry.coordinates.map(geoJsonRing)
      : [geoJsonRing(geometry.coordinates)];
  return packGeodeticRings(rings, applied);
}

/** `built` as GeoJSON `[lng, lat, height]` positions, ring by ring. */
export function toGeoJsonRings(built: BuiltPositions): Position[][] {
  return built.rings.map((ring) => {
    const positions: Position[] = [];
    for (let i = 0; i < ring.length; i += 3) {
      if (built.geocentric) {
        const p = vector3ToGeodetic(
          new Vector3(ring[i], ring[i + 1], ring[i + 2]),
        );
        positions.push([p.lng, p.lat, p.height]);
      } else {
        positions.push([ring[i], ring[i + 1], ring[i + 2]]);
      }
    }
    return positions;
  });
}
