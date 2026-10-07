import type { NormalizeWASMClass } from "@navaramap/core";
import {
  buildPolygonGeometry as buildPolygonGeometryWasm,
  buildPolylineGeometry as buildPolylineGeometryWasm,
  polygonGroundVolume as polygonGroundVolumeWasm,
  polylineGroundVolume as polylineGroundVolumeWasm,
  angleToDegree,
  angleToRadian,
  type PolygonMaterial,
  type PolylineMaterial,
} from "@navaramap/engine-api";

/**
 * Geometry builders for standalone polygon and polyline meshes, using the
 * vector layer's construction. Positions are RTE-encoded.
 */

/** A polygon layer material, as a plain object. */
export type PolygonGeometryMaterial = NormalizeWASMClass<PolygonMaterial>;

/** A polyline layer material, as a plain object. */
export type PolylineGeometryMaterial = NormalizeWASMClass<PolylineMaterial>;

/** A geographic bounding box, in degrees. */
export type GeographicExtent = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type PolygonGeometryData = {
  positionHigh: Float32Array;
  positionLow: Float32Array;
  /** Absent for a `clampToGround` polygon. */
  normal?: Float32Array;
  /** `xyz` = extrusion direction, `w` = 0 on the bottom cap, 1 on the top. */
  scaleNormalAndCap: Float32Array;
  indices: Uint32Array;
  extent: GeographicExtent;
};

export type PolylineGeometryData = {
  position: Float32Array;
  positionHigh: Float32Array;
  positionLow: Float32Array;
  startHigh: Float32Array;
  startLow: Float32Array;
  endHigh: Float32Array;
  endLow: Float32Array;
  startNormal: Float32Array;
  endNormalAndTextureCoordinateNormalizationX: Float32Array;
  rightNormalAndTextureCoordinateNormalizationY: Float32Array;
  indices: Uint32Array;
  extent: GeographicExtent;
};

/** Flat `[lng, lat, height, ...]`, or ECEF `[x, y, z, ...]` when geocentric. */
export type GeometryRing = Float64Array;

function toDegrees(extent: {
  west: number;
  south: number;
  east: number;
  north: number;
}): GeographicExtent {
  return {
    west: angleToDegree(extent.west),
    south: angleToDegree(extent.south),
    east: angleToDegree(extent.east),
    north: angleToDegree(extent.north),
  };
}

/** Concatenates rings; the builder splits them by `ringLengths`. */
function concatRings(rings: readonly GeometryRing[]): Float64Array {
  let total = 0;
  for (const ring of rings) total += ring.length;

  const coordinates = new Float64Array(total);
  let offset = 0;
  for (const ring of rings) {
    coordinates.set(ring, offset);
    offset += ring.length;
  }
  return coordinates;
}

function ringLengths(rings: readonly GeometryRing[]): Uint32Array {
  const lengths = new Uint32Array(rings.length);
  for (let i = 0; i < rings.length; i++) {
    lengths[i] = rings[i].length / 3;
  }
  return lengths;
}

/**
 * Builds the geometry of one standalone polygon.
 *
 * @param rings - Outer ring first, then holes.
 * @param geocentric - Read the positions as ECEF metres.
 * @param material - A `polygon` layer material. Outline options are ignored.
 * @throws When `material` does not deserialize.
 * @returns `undefined` when the outer ring has fewer than three vertices or is
 *   collinear.
 */
export function buildPolygonGeometry(
  rings: readonly GeometryRing[],
  geocentric: boolean,
  material: PolygonGeometryMaterial,
): PolygonGeometryData | undefined {
  const built = buildPolygonGeometryWasm(
    concatRings(rings),
    ringLengths(rings),
    geocentric,
    material,
  );
  if (!built) return undefined;

  try {
    const positionHigh = built.position_3d_high();
    const positionLow = built.position_3d_low();
    const extent = built.extent;
    if (!positionHigh || !positionLow || !extent) {
      throw new Error("buildPolygonGeometry: incomplete RTE geometry");
    }

    const scaleNormalAndCap = built.scale_normal_and_cap();
    if (!scaleNormalAndCap) {
      throw new Error("buildPolygonGeometry: missing extrusion attribute");
    }

    return {
      positionHigh,
      positionLow,
      normal: built.normal(),
      scaleNormalAndCap,
      indices: built.indices(),
      extent: toDegrees(extent),
    };
  } finally {
    built.free();
  }
}

/**
 * Builds the geometry of one standalone polyline.
 *
 * @param positions - Flat `[lng, lat, height, ...]`, or ECEF when `geocentric`.
 * @param geocentric - Read the positions as ECEF metres.
 * @param ring - Join a repeated first vertex as a seam instead of two caps.
 * @param material - A `polyline` layer material.
 * @throws When `material` does not deserialize.
 * @returns `undefined` when fewer than two distinct positions remain.
 */
export function buildPolylineGeometry(
  positions: Float64Array,
  geocentric: boolean,
  ring: boolean,
  material: PolylineGeometryMaterial,
): PolylineGeometryData | undefined {
  const built = buildPolylineGeometryWasm(
    positions,
    geocentric,
    ring,
    material,
  );
  if (!built) return undefined;

  try {
    const positionHigh = built.position_high();
    const positionLow = built.position_low();
    const startHigh = built.start_high();
    const startLow = built.start_low();
    const endHigh = built.end_high();
    const endLow = built.end_low();
    const startNormal = built.start_normals();
    const endNormal = built.end_normal_and_texture_coordinate_normalization_x();
    const extent = built.extent;
    if (
      !positionHigh ||
      !positionLow ||
      !startHigh ||
      !startLow ||
      !endHigh ||
      !endLow ||
      !startNormal ||
      !endNormal ||
      !extent
    ) {
      throw new Error("buildPolylineGeometry: incomplete RTE geometry");
    }

    return {
      position: built.position(),
      positionHigh,
      positionLow,
      startHigh,
      startLow,
      endHigh,
      endLow,
      startNormal,
      endNormalAndTextureCoordinateNormalizationX: endNormal,
      rightNormalAndTextureCoordinateNormalizationY:
        built.right_normal_and_texture_coordinate_normalization_y(),
      indices: built.indices(),
      extent: toDegrees(extent),
    };
  } finally {
    built.free();
  }
}

/** A height range in metres, relative to the ellipsoid. */
export type HeightRange = { min: number; max: number };

function groundVolume(
  build: typeof polygonGroundVolumeWasm,
  range: HeightRange,
  extent: GeographicExtent,
): [number, number] {
  const heights = build(
    range.min,
    range.max,
    angleToRadian(extent.west),
    angleToRadian(extent.south),
    angleToRadian(extent.east),
    angleToRadian(extent.north),
  );
  return [heights[0], heights[1]];
}

/**
 * `[min, max]` height a clamp-to-ground polygon volume over `extent` must
 * span to enclose the ground heights `range`, given the flat cap triangles
 * {@link buildPolygonGeometry} produces.
 */
export function polygonGroundVolume(
  range: HeightRange,
  extent: GeographicExtent,
): [number, number] {
  return groundVolume(polygonGroundVolumeWasm, range, extent);
}

/**
 * `[min, max]` height a clamp-to-ground polyline volume over `extent` must
 * span to enclose the ground heights `range`, given the straight segments
 * {@link buildPolylineGeometry} produces.
 */
export function polylineGroundVolume(
  range: HeightRange,
  extent: GeographicExtent,
): [number, number] {
  return groundVolume(polylineGroundVolumeWasm, range, extent);
}
