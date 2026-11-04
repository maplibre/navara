/**
 * Placing street lamps, roof beacons and cars along the roads of one tile,
 * from seeded random sequences so a tile looks the same each time it
 * streams in.
 */
import type { Feature, FeatureCollection, Point, Position } from "geojson";
import type { Vector3 } from "three";

import type { StreetTrafficData } from "./StreetTrafficMeshDesc";
import type { Road, RoadNetwork, TileCoordinate } from "./tiles";

const METERS_PER_DEGREE = 111320;

// --- Random sequences ------------------------------------------------------

/**
 * mulberry32: a seeded random sequence in [0, 1). The same algorithm as
 * three's `MathUtils.seededRandom`, but with its state in the closure:
 * tiles stream in asynchronously, so drawing from that one shared sequence
 * would let another user of it shift the placement.
 */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * The seed of one tile's `stream` (lamps, cars, ...), mixed from the base
 * seed and the tile coordinate so neighbouring tiles draw different
 * sequences and the same tile always draws the same one.
 */
export const tileSeed = (
  seed: number,
  tile: TileCoordinate,
  stream: number,
): number =>
  (seed ^
    Math.imul(tile.x, 0x9e3779b1) ^
    Math.imul(tile.y, 0x85ebca77) ^
    Math.imul(stream + 1, 0x27d4eb2f)) |
  0;

// --- Placement along the roads ---------------------------------------------

/** One segment of a line in meters, with the left-hand normal of its direction. */
const segmentMeters = (line: Position[], i: number) => {
  const [lng0, lat0] = line[i - 1];
  const [lng1, lat1] = line[i];
  const metersPerDegreeLng =
    METERS_PER_DEGREE * Math.cos((lat0 * Math.PI) / 180);
  const dx = (lng1 - lng0) * metersPerDegreeLng;
  const dy = (lat1 - lat0) * METERS_PER_DEGREE;
  const length = Math.hypot(dx, dy);
  return {
    lng0,
    lat0,
    lng1,
    lat1,
    length,
    metersPerDegreeLng,
    ux: dx / length,
    uy: dy / length,
    nx: -dy / length,
    ny: dx / length,
  };
};

export type LampProperties = { kind: "lamp" | "warm" };
type BeaconProperties = {
  /** Meters above the ellipsoid. */
  height: number;
};

type TileLights = {
  lamps: FeatureCollection<Point, LampProperties>;
  beacons: FeatureCollection<Point, BeaconProperties>;
};

const light = <P>(
  lng: number,
  lat: number,
  properties: P,
): Feature<Point, P> => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties,
});

/** Lamps spaced along one road centerline, alternating sides. */
export const lampsAlongLine = (
  line: Position[],
  spacing: number,
  offset: number,
  rand: () => number,
  out: Feature<Point, LampProperties>[],
) => {
  let carry = spacing * rand();
  let side = rand() < 0.5 ? -1 : 1;
  for (let i = 1; i < line.length; i++) {
    const s = segmentMeters(line, i);
    if (s.length === 0) continue;

    let t = carry;
    while (t < s.length) {
      const lng =
        s.lng0 + (s.ux * t + s.nx * offset * side) / s.metersPerDegreeLng;
      const lat =
        s.lat0 + (s.uy * t + s.ny * offset * side) / METERS_PER_DEGREE;
      out.push(light(lng, lat, { kind: rand() < 0.75 ? "lamp" : "warm" }));
      side = -side;
      t += spacing;
    }
    carry = t - s.length;
  }
};

/**
 * Street lamps along every road and a red beacon on every tall roof. `rand`
 * decides the lamp spacing phase, side and color; give a tile the same
 * sequence to get the same lights each time it streams in.
 */
export const tileLights = (
  network: RoadNetwork,
  rand: () => number,
): TileLights => {
  const lamps: Feature<Point, LampProperties>[] = [];
  for (const road of network.roads) {
    const { spacing, offset } = road.style.lamp;
    lampsAlongLine(road.line, spacing, offset, rand, lamps);
  }

  const beacons = network.tallBuildings.map((building) =>
    light(building.lng, building.lat, { height: building.height + 2 }),
  );

  return {
    lamps: { type: "FeatureCollection", features: lamps },
    beacons: { type: "FeatureCollection", features: beacons },
  };
};

const CAR_HEIGHT = 0.6;

/** A geodetic position in degrees and meters to ECEF meters. */
type Project = (position: {
  lng: number;
  lat: number;
  height: number;
}) => Vector3;

/**
 * Scatters cars over the road segments; each car drives one segment and
 * wraps. Positions are ECEF offsets from `origin`, which keeps them float32
 * precise. `rand` decides the car counts, phases and speeds.
 */
export const buildTraffic = (
  roads: Road[],
  origin: Vector3,
  project: Project,
  rand: () => number,
): StreetTrafficData => {
  const start: number[] = [];
  const end: number[] = [];
  const phase: number[] = [];
  const speed: number[] = [];

  const push = (target: number[], lng: number, lat: number) => {
    const p = project({ lat, lng, height: CAR_HEIGHT }).sub(origin);
    target.push(p.x, p.y, p.z);
  };

  for (const road of roads) {
    const style = road.style.traffic;

    for (let i = 1; i < road.line.length; i++) {
      const s = segmentMeters(road.line, i);
      if (s.length < 1) continue;

      for (const direction of [1, -1]) {
        if (road.oneway === -direction) continue;
        // Expected car count, with the fraction decided by chance.
        const expected = s.length / style.spacing;
        const count = Math.floor(expected) + (rand() < expected % 1 ? 1 : 0);
        // Left of the direction of travel.
        const ox = s.nx * style.lane * direction;
        const oy = s.ny * style.lane * direction;
        const aLng = s.lng0 + ox / s.metersPerDegreeLng;
        const aLat = s.lat0 + oy / METERS_PER_DEGREE;
        const bLng = s.lng1 + ox / s.metersPerDegreeLng;
        const bLat = s.lat1 + oy / METERS_PER_DEGREE;

        for (let k = 0; k < count; k++) {
          if (direction === 1) {
            push(start, aLng, aLat);
            push(end, bLng, bLat);
          } else {
            push(start, bLng, bLat);
            push(end, aLng, aLat);
          }
          phase.push(rand());
          speed.push(style.speed * (0.7 + 0.6 * rand()));
        }
      }
    }
  }

  return {
    start: new Float32Array(start),
    end: new Float32Array(end),
    phase: new Float32Array(phase),
    speed: new Float32Array(speed),
  };
};
