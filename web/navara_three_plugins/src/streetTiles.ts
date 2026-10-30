/**
 * Road and building reading from OpenMapTiles-schema vector tiles, the tile
 * streaming around a position, and the placement of street lamps, roof
 * beacons and cars along the roads read. Shared by `StreetLightsPlugin`;
 * nothing here touches the view.
 */
import { VectorTile } from "@mapbox/vector-tile";
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";
import { PbfReader } from "pbf";
import { MathUtils, type Vector3 } from "three";

import type { StreetTrafficData } from "./StreetTrafficMeshDesc";

// --- OpenMapTiles road classes ---------------------------------------------

export type RoadStyle = {
  /** Width of the road surface in pixels. */
  width: number;
  /** Street lamp spacing along the road and distance from the centerline, in meters. */
  lamp: { spacing: number; offset: number };
  /**
   * Cars per direction: one every `spacing` meters, driving `lane` meters
   * left of the centerline (left-hand traffic) at about `speed` m/s.
   */
  traffic: { spacing: number; lane: number; speed: number };
};

/**
 * The OpenMapTiles `transportation` classes that carry lights and traffic.
 * Rail, paths, ferries and the rest are left out.
 */
export const ROADS: Record<string, RoadStyle> = {
  motorway: {
    width: 6,
    lamp: { spacing: 30, offset: 9 },
    traffic: { spacing: 25, lane: 6, speed: 22 },
  },
  trunk: {
    width: 5,
    lamp: { spacing: 30, offset: 7 },
    traffic: { spacing: 30, lane: 4.5, speed: 14 },
  },
  primary: {
    width: 4.5,
    lamp: { spacing: 35, offset: 7 },
    traffic: { spacing: 35, lane: 4.5, speed: 12 },
  },
  secondary: {
    width: 4,
    lamp: { spacing: 40, offset: 6 },
    traffic: { spacing: 50, lane: 3.5, speed: 11 },
  },
  tertiary: {
    width: 3.5,
    lamp: { spacing: 45, offset: 5 },
    traffic: { spacing: 70, lane: 3, speed: 9 },
  },
  minor: {
    width: 2.5,
    lamp: { spacing: 60, offset: 4 },
    traffic: { spacing: 120, lane: 2.5, speed: 7 },
  },
  service: {
    width: 1.5,
    lamp: { spacing: 90, offset: 3 },
    traffic: { spacing: 250, lane: 1.5, speed: 5 },
  },
};

/** The style of a feature's `class`, or `undefined` for a class without lights. */
export const roadStyle = (roadClass: unknown): RoadStyle | undefined =>
  typeof roadClass === "string" ? ROADS[roadClass] : undefined;

// --- OpenMapTiles road tiles -----------------------------------------------

export type Road = {
  /** OpenMapTiles `transportation` class, one of {@link ROADS}. */
  roadClass: string;
  /** 1 forward only, -1 backward only, 0 both ways. */
  oneway: number;
  /** Centerline as [lng, lat] positions. */
  line: Position[];
};

export type TallBuilding = {
  lng: number;
  lat: number;
  height: number;
};

export type RoadNetwork = {
  roads: Road[];
  tallBuildings: TallBuilding[];
};

export type TileCoordinate = { x: number; y: number };

/** The parts of a decoded tile layer the readers use; `VectorTileLayer` is one. */
export type TileLayer = {
  length: number;
  feature(index: number): {
    properties: Record<string, unknown>;
    toGeoJSON(x: number, y: number, z: number): Feature;
  };
};

export const ZOOM = 14;

// Buildings at least this tall get a beacon. High enough that skyscraper
// districts do not turn into a red mass.
export const TALL_BUILDING_HEIGHT = 90;

const METERS_PER_DEGREE = 111320;

/** The zoom-14 tile containing a position. */
export const tileCoordinate = (lng: number, lat: number): TileCoordinate => {
  const rad = (lat * Math.PI) / 180;
  const n = 2 ** ZOOM;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
    ),
  };
};

export const tileCenter = (
  tile: TileCoordinate,
): { lng: number; lat: number } => {
  const n = 2 ** ZOOM;
  const lng = ((tile.x + 0.5) / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + 0.5)) / n))) * 180) /
    Math.PI;
  return { lng, lat };
};

export const tileKey = (tile: TileCoordinate) => `${tile.x}/${tile.y}`;

export const chebyshev = (a: TileCoordinate, b: TileCoordinate) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const lineStrings = (geometry: LineString | MultiLineString): Position[][] =>
  geometry.type === "LineString"
    ? [geometry.coordinates]
    : geometry.coordinates;

const outerRings = (geometry: Polygon | MultiPolygon): Position[][] =>
  geometry.type === "Polygon"
    ? [geometry.coordinates[0]]
    : geometry.coordinates.map((polygon) => polygon[0]);

export const readRoads = (
  layer: TileLayer,
  tile: TileCoordinate,
  out: Road[],
) => {
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const roadClass = feature.properties.class;
    if (typeof roadClass !== "string" || !roadStyle(roadClass)) continue;

    const geometry = feature.toGeoJSON(tile.x, tile.y, ZOOM).geometry;
    if (geometry.type !== "LineString" && geometry.type !== "MultiLineString")
      continue;
    const oneway = feature.properties.oneway;
    for (const line of lineStrings(geometry)) {
      out.push({
        roadClass,
        oneway: typeof oneway === "number" ? oneway : 0,
        line,
      });
    }
  }
};

/** Roof center of every tall building, one per outer ring. */
export const readTallBuildings = (
  layer: TileLayer,
  tile: TileCoordinate,
  out: TallBuilding[],
) => {
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const height = feature.properties.render_height;
    if (typeof height !== "number" || height < TALL_BUILDING_HEIGHT) continue;

    const geometry = feature.toGeoJSON(tile.x, tile.y, ZOOM).geometry;
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
      continue;
    for (const ring of outerRings(geometry)) {
      // A GeoJSON ring repeats its first position at the end.
      const vertices = ring.length - 1;
      let lng = 0;
      let lat = 0;
      for (let v = 0; v < vertices; v++) {
        lng += ring[v][0];
        lat += ring[v][1];
      }
      out.push({ lng: lng / vertices, lat: lat / vertices, height });
    }
  }
};

/**
 * Reads the roads and tall buildings of one zoom-14 tile. `template` is a
 * `{z}/{x}/{y}` tile URL, as listed in a TileJSON document. The engine
 * decodes these same tiles for rendering but exposes no feature geometry,
 * hence the second fetch.
 */
export const loadRoadNetwork = async (
  template: string,
  tile: TileCoordinate,
  signal: AbortSignal,
): Promise<RoadNetwork> => {
  const url = template
    .replace("{z}", String(ZOOM))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Tile ${url} failed (${res.status})`);
  const vectorTile = new VectorTile(new PbfReader(await res.arrayBuffer()));

  const roads: Road[] = [];
  const tallBuildings: TallBuilding[] = [];
  const transportation = vectorTile.layers.transportation;
  if (transportation) readRoads(transportation, tile, roads);
  const building = vectorTile.layers.building;
  if (building) readTallBuildings(building, tile, tallBuildings);
  return { roads, tallBuildings };
};

// --- Tile streaming --------------------------------------------------------

export type TileStreamer<T> = {
  /** Loaded tiles by key. */
  readonly tiles: ReadonlyMap<string, { tile: TileCoordinate; loaded: T }>;
  /** Re-centers on a position; loads tiles that came into range, drops the rest. */
  update(lng: number, lat: number): void;
  /** Drops every loaded tile and aborts the ones still loading. */
  dispose(): void;
};

/**
 * Keeps the tiles within `radius` of a center tile loaded, through `add`
 * (async, aborted through its signal once the tile is no longer wanted) and
 * `remove`. Nothing happens while the center tile is unchanged.
 */
export const createTileStreamer = <T>(
  radius: number,
  add: (tile: TileCoordinate, signal: AbortSignal) => Promise<T>,
  remove: (loaded: T) => void,
): TileStreamer<T> => {
  const tiles = new Map<string, { tile: TileCoordinate; loaded: T }>();
  const pending = new Map<string, AbortController>();
  let center: TileCoordinate | undefined;

  const inRange = (tile: TileCoordinate) =>
    center !== undefined && chebyshev(tile, center) <= radius;

  const update = (lng: number, lat: number) => {
    const next = tileCoordinate(lng, lat);
    if (center && center.x === next.x && center.y === next.y) return;
    center = next;

    for (const [key, entry] of tiles) {
      if (!inRange(entry.tile)) {
        remove(entry.loaded);
        tiles.delete(key);
      }
    }

    // Nearest first, so the view fills in from the camera outward.
    const wanted: TileCoordinate[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        wanted.push({ x: next.x + dx, y: next.y + dy });
      }
    }
    wanted.sort((a, b) => chebyshev(a, next) - chebyshev(b, next));
    const wantedKeys = new Set(wanted.map(tileKey));

    for (const [key, controller] of pending) {
      if (!wantedKeys.has(key)) {
        controller.abort();
        pending.delete(key);
      }
    }

    for (const tile of wanted) {
      const key = tileKey(tile);
      if (tiles.has(key) || pending.has(key)) continue;
      const controller = new AbortController();
      pending.set(key, controller);
      add(tile, controller.signal).then(
        (loaded) => {
          pending.delete(key);
          // The camera may have moved on while this tile was loading.
          if (controller.signal.aborted || !inRange(tile)) {
            remove(loaded);
            return;
          }
          tiles.set(key, { tile, loaded });
        },
        (error: unknown) => {
          pending.delete(key);
          if (!controller.signal.aborted) console.error(error);
        },
      );
    }
  };

  const dispose = () => {
    for (const controller of pending.values()) controller.abort();
    pending.clear();
    for (const { loaded } of tiles.values()) remove(loaded);
    tiles.clear();
    center = undefined;
  };

  return { tiles, update, dispose };
};

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
export type BeaconProperties = {
  /** Meters above the ellipsoid. */
  height: number;
};

export type TileLights = {
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

/** Street lamps along every road and a red beacon on every tall roof. */
export const tileLights = (network: RoadNetwork): TileLights => {
  // Reseeded so a tile looks the same each time it streams in.
  MathUtils.seededRandom(7);
  const rand = () => MathUtils.seededRandom();
  const lamps: Feature<Point, LampProperties>[] = [];
  for (const road of network.roads) {
    const style = roadStyle(road.roadClass);
    if (style) {
      lampsAlongLine(
        road.line,
        style.lamp.spacing,
        style.lamp.offset,
        rand,
        lamps,
      );
    }
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
export type Project = (position: {
  lng: number;
  lat: number;
  height: number;
}) => Vector3;

/**
 * Scatters cars over the road segments; each car drives one segment and
 * wraps. Positions are ECEF offsets from `origin`, which keeps them float32
 * precise.
 */
export const buildTraffic = (
  roads: Road[],
  origin: Vector3,
  project: Project,
): StreetTrafficData => {
  // Reseeded for every tile, like `tileLights`.
  MathUtils.seededRandom(11);
  const rand = () => MathUtils.seededRandom();
  const start: number[] = [];
  const end: number[] = [];
  const phase: number[] = [];
  const speed: number[] = [];

  const push = (target: number[], lng: number, lat: number) => {
    const p = project({ lat, lng, height: CAR_HEIGHT }).sub(origin);
    target.push(p.x, p.y, p.z);
  };

  for (const road of roads) {
    const style = roadStyle(road.roadClass)?.traffic;
    if (!style) continue;

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
