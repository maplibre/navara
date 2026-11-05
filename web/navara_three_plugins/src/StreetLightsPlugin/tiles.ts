/**
 * Reading roads and beacon tallBuildings from zoom-14 vector tiles, and keeping
 * the tiles around a position loaded.
 */
import { VectorTile } from "@mapbox/vector-tile";
import type {
  Feature,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import { PbfReader } from "pbf";

import {
  pickProperties,
  readRoadFeature,
  type BuildingReader,
  type Oneway,
  type StreetLightsRoads,
  type RoadStyle,
  type TileSchema,
} from "./roads";

// --- Reading the tiles -----------------------------------------------------

export type Road = {
  style: RoadStyle;
  /** 1 forward only, -1 backward only, 0 both ways. */
  oneway: Oneway;
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

const ZOOM = 14;

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
  schema: StreetLightsRoads,
  out: Road[],
) => {
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const properties = schema.properties
      ? pickProperties(feature.properties, schema.properties)
      : feature.properties;
    const road = readRoadFeature(schema, properties);
    if (!road) continue;

    const geometry = feature.toGeoJSON(tile.x, tile.y, ZOOM).geometry;
    if (geometry.type !== "LineString" && geometry.type !== "MultiLineString")
      continue;
    for (const line of lineStrings(geometry)) {
      out.push({ style: road.style, oneway: road.oneway, line });
    }
  }
};

/** TallBuilding center of every building the reader gives a height, one per outer ring. */
export const readTallBuildings = (
  layer: TileLayer,
  tile: TileCoordinate,
  read: BuildingReader,
  out: TallBuilding[],
) => {
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const height = read(feature.properties);
    // A reader computing the height can come back with NaN.
    if (height === undefined || !Number.isFinite(height)) continue;

    const geometry = feature.toGeoJSON(tile.x, tile.y, ZOOM).geometry;
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
      continue;
    for (const ring of outerRings(geometry)) {
      // A GeoJSON ring repeats its first position at the end.
      const vertices = ring.length - 1;
      if (vertices < 1) continue;
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
 * Reads the roads and beacon tallBuildings of one zoom-14 tile. `template` is a
 * `{z}/{x}/{y}` tile URL, as listed in a TileJSON document. The engine
 * decodes these same tiles for rendering but exposes no feature geometry,
 * hence the second fetch.
 */
export const loadRoadNetwork = async (
  template: string,
  tile: TileCoordinate,
  schema: TileSchema,
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
  const roadLayer = vectorTile.layers[schema.roads.layer];
  if (roadLayer) readRoads(roadLayer, tile, schema.roads, roads);
  const buildingLayer = vectorTile.layers[schema.buildings.layer];
  if (buildingLayer) {
    readTallBuildings(
      buildingLayer,
      tile,
      schema.buildings.read,
      tallBuildings,
    );
  }
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
      // A load aborted earlier may settle after the same tile was asked for
      // again: only its own entry is cleared.
      const settle = () => {
        if (pending.get(key) === controller) pending.delete(key);
      };
      add(tile, controller.signal).then(
        (loaded) => {
          settle();
          // The camera may have moved on while this tile was loading.
          if (controller.signal.aborted || !inRange(tile)) {
            remove(loaded);
            return;
          }
          tiles.set(key, { tile, loaded });
        },
        (error: unknown) => {
          settle();
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
