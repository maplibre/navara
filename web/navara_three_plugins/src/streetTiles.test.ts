import type { Feature, Geometry, Point, Position } from "geojson";
import { Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTraffic,
  chebyshev,
  createTileStreamer,
  lampsAlongLine,
  loadRoadNetwork,
  readRoads,
  readTallBuildings,
  tileCenter,
  tileCoordinate,
  tileKey,
  tileLights,
  type LampProperties,
  type Road,
  type RoadNetwork,
  type TallBuilding,
  type TileCoordinate,
  type TileLayer,
} from "./streetTiles";

const TOKYO = { lng: 139.762, lat: 35.672 };
const METERS_PER_DEGREE = 111320;
const TILE = { x: 0, y: 0 };

/** A decoded tile layer built from plain features. */
const layerOf = (
  features: { properties: Record<string, unknown>; geometry: Geometry }[],
): TileLayer => ({
  length: features.length,
  feature: (index) => ({
    properties: features[index].properties,
    toGeoJSON: () => ({
      type: "Feature",
      properties: features[index].properties,
      geometry: features[index].geometry,
    }),
  }),
});

/** An east-west line on the equator, `meters` long. */
const eastLine = (meters: number): Position[] => [
  [0, 0],
  [meters / METERS_PER_DEGREE, 0],
];

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tile coordinates", () => {
  it("maps positions to zoom-14 tiles and back", () => {
    expect(tileCoordinate(0, 0)).toEqual({ x: 8192, y: 8192 });
    const tile = tileCoordinate(TOKYO.lng, TOKYO.lat);
    const center = tileCenter(tile);
    expect(tileCoordinate(center.lng, center.lat)).toEqual(tile);
    expect(tileKey(tile)).toBe(`${tile.x}/${tile.y}`);
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: -2 })).toBe(3);
  });
});

describe("readRoads", () => {
  it("reads the classes that carry lights, one road per line string", () => {
    const out: Road[] = [];
    readRoads(
      layerOf([
        {
          properties: { class: "primary", oneway: 1 },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
        {
          properties: { class: "minor" },
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [0, 0],
                [1, 0],
              ],
              [
                [0, 1],
                [1, 1],
              ],
            ],
          },
        },
        {
          properties: { class: "rail" },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
        {
          properties: { class: "primary" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        },
      ]),
      TILE,
      out,
    );
    expect(out).toEqual([
      {
        roadClass: "primary",
        oneway: 1,
        line: [
          [0, 0],
          [1, 1],
        ],
      },
      {
        roadClass: "minor",
        oneway: 0,
        line: [
          [0, 0],
          [1, 0],
        ],
      },
      {
        roadClass: "minor",
        oneway: 0,
        line: [
          [0, 1],
          [1, 1],
        ],
      },
    ]);
  });
});

describe("readTallBuildings", () => {
  it("reads the roof center of every building 90 m or taller", () => {
    const square = (x: number, y: number): Position[][] => [
      [
        [x, y],
        [x + 2, y],
        [x + 2, y + 2],
        [x, y + 2],
        [x, y],
      ],
    ];
    const out: TallBuilding[] = [];
    readTallBuildings(
      layerOf([
        {
          properties: { render_height: 120 },
          geometry: { type: "Polygon", coordinates: square(0, 0) },
        },
        {
          properties: { render_height: 50 },
          geometry: { type: "Polygon", coordinates: square(0, 0) },
        },
        {
          properties: { render_height: 100 },
          geometry: {
            type: "MultiPolygon",
            coordinates: [square(0, 0), square(10, 10)],
          },
        },
      ]),
      TILE,
      out,
    );
    expect(out).toEqual([
      { lng: 1, lat: 1, height: 120 },
      { lng: 1, lat: 1, height: 100 },
      { lng: 11, lat: 11, height: 100 },
    ]);
  });
});

describe("loadRoadNetwork", () => {
  it("rejects a tile the server does not serve", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { signal } = new AbortController();

    await expect(
      loadRoadNetwork("https://t/{z}/{x}/{y}.pbf", { x: 1, y: 2 }, signal),
    ).rejects.toThrow("failed (404)");
    expect(fetchMock).toHaveBeenCalledWith("https://t/14/1/2.pbf", { signal });
  });
});

describe("createTileStreamer", () => {
  it("loads the tiles around the center nearest first and drops the ones out of range", async () => {
    const add = vi.fn(async (tile: TileCoordinate, _signal: AbortSignal) =>
      tileKey(tile),
    );
    const remove = vi.fn();
    const streamer = createTileStreamer(1, add, remove);
    const center = tileCoordinate(TOKYO.lng, TOKYO.lat);

    streamer.update(TOKYO.lng, TOKYO.lat);
    expect(add).toHaveBeenCalledTimes(9);
    expect(add.mock.calls[0][0]).toEqual(center);
    await flush();
    expect(streamer.tiles.size).toBe(9);

    // Still inside the center tile: nothing to do.
    streamer.update(TOKYO.lng + 0.0001, TOKYO.lat);
    expect(add).toHaveBeenCalledTimes(9);

    // Two tiles east: the two west columns go, two new ones come.
    const east = tileCenter({ x: center.x + 2, y: center.y });
    streamer.update(east.lng, east.lat);
    expect(remove).toHaveBeenCalledTimes(6);
    expect(add).toHaveBeenCalledTimes(15);
  });

  it("aborts a tile the center moved away from and drops it if it still arrives", async () => {
    const resolvers: (() => void)[] = [];
    const signals: AbortSignal[] = [];
    const add = vi.fn(
      (tile: TileCoordinate, signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          signals.push(signal);
          resolvers.push(() => resolve(tileKey(tile)));
        }),
    );
    const remove = vi.fn();
    const streamer = createTileStreamer(0, add, remove);
    const center = tileCoordinate(TOKYO.lng, TOKYO.lat);

    streamer.update(TOKYO.lng, TOKYO.lat);
    const far = tileCenter({ x: center.x + 10, y: center.y });
    streamer.update(far.lng, far.lat);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    resolvers[0]();
    await flush();
    expect(remove).toHaveBeenCalledWith(tileKey(center));
    expect(streamer.tiles.has(tileKey(center))).toBe(false);
  });

  it("logs a failed tile once and asks for it again on the next move", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const add = vi.fn(async (tile: TileCoordinate, _signal: AbortSignal) => {
      if (fail) throw new Error("boom");
      return tileKey(tile);
    });
    const streamer = createTileStreamer(0, add, vi.fn());
    const center = tileCoordinate(TOKYO.lng, TOKYO.lat);

    streamer.update(TOKYO.lng, TOKYO.lat);
    await flush();
    expect(error).toHaveBeenCalledTimes(1);
    expect(streamer.tiles.size).toBe(0);

    fail = false;
    const next = tileCenter({ x: center.x + 1, y: center.y });
    streamer.update(next.lng, next.lat);
    streamer.update(TOKYO.lng, TOKYO.lat);
    await flush();
    expect(add).toHaveBeenCalledTimes(3);
    expect(streamer.tiles.has(tileKey(center))).toBe(true);
  });

  it("dispose() drops every tile and aborts the ones still loading", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending: {
      signal: AbortSignal;
      resolve: () => void;
      reject: () => void;
    }[] = [];
    const add = vi.fn(
      (tile: TileCoordinate, signal: AbortSignal) =>
        new Promise<string>((resolve, reject) => {
          pending.push({
            signal,
            resolve: () => resolve(tileKey(tile)),
            reject: () => reject(new Error("late")),
          });
        }),
    );
    const remove = vi.fn();
    const streamer = createTileStreamer(1, add, remove);

    streamer.update(TOKYO.lng, TOKYO.lat);
    pending[0].resolve();
    pending[1].resolve();
    await flush();
    expect(streamer.tiles.size).toBe(2);

    streamer.dispose();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(streamer.tiles.size).toBe(0);
    expect(pending.slice(2).every((p) => p.signal.aborted)).toBe(true);

    pending[2].resolve();
    pending[3].reject();
    await flush();
    expect(remove).toHaveBeenCalledTimes(3);
    expect(streamer.tiles.size).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });
});

describe("lampsAlongLine", () => {
  it("spaces lamps along the line, alternating sides", () => {
    const out: Feature<Point, LampProperties>[] = [];
    lampsAlongLine(eastLine(100), 30, 5, () => 0, out);

    const along = out.map((f) => f.geometry.coordinates[0] * METERS_PER_DEGREE);
    expect(along.map((m) => Math.round(m))).toEqual([0, 30, 60, 90]);
    const sides = out.map((f) => Math.sign(f.geometry.coordinates[1]));
    expect(sides).toEqual([-1, 1, -1, 1]);
    expect(out.every((f) => f.properties.kind === "lamp")).toBe(true);
  });

  it("starts at a random carry and draws warm lamps from the same source", () => {
    const out: Feature<Point, LampProperties>[] = [];
    lampsAlongLine(eastLine(100), 30, 5, () => 0.9, out);

    const along = out.map((f) => f.geometry.coordinates[0] * METERS_PER_DEGREE);
    expect(along.map((m) => Math.round(m))).toEqual([27, 57, 87]);
    expect(out.every((f) => f.properties.kind === "warm")).toBe(true);
  });
});

describe("tileLights", () => {
  const network: RoadNetwork = {
    roads: [{ roadClass: "primary", oneway: 0, line: eastLine(100) }],
    tallBuildings: [{ lng: 1, lat: 2, height: 120 }],
  };

  it("adds a beacon above every tall roof and the same lamps every time", () => {
    const lights = tileLights(network);
    expect(lights.beacons.features).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [1, 2] },
        properties: { height: 122 },
      },
    ]);
    expect(lights.lamps.features.length).toBeGreaterThan(0);
    expect(tileLights(network)).toEqual(lights);
  });
});

describe("buildTraffic", () => {
  const project = ({
    lng,
    lat,
    height,
  }: {
    lng: number;
    lat: number;
    height: number;
  }) => new Vector3(lng * METERS_PER_DEGREE, lat * METERS_PER_DEGREE, height);
  const ORIGIN = new Vector3();
  const segment = (oneway: number, meters = 350): Road => ({
    roadClass: "primary",
    oneway,
    line: eastLine(meters),
  });
  /** Sign of each car's travel along the x axis. */
  const headings = (data: ReturnType<typeof buildTraffic>) =>
    Array.from(data.phase, (_, i) =>
      Math.sign(data.end[i * 3] - data.start[i * 3]),
    );

  it("places cars both ways on a two-way road at the class speed", () => {
    const data = buildTraffic([segment(0)], ORIGIN, project);
    const cars = data.phase.length;
    expect(cars).toBeGreaterThan(0);
    expect(data.start.length).toBe(cars * 3);
    expect(data.end.length).toBe(cars * 3);
    expect(data.speed.length).toBe(cars);
    expect(headings(data)).toContain(1);
    expect(headings(data)).toContain(-1);
    for (const speed of data.speed) {
      expect(speed).toBeGreaterThanOrEqual(12 * 0.7);
      expect(speed).toBeLessThanOrEqual(12 * 1.3);
    }
  });

  it("keeps a one-way road to its direction", () => {
    expect(headings(buildTraffic([segment(1)], ORIGIN, project))).not.toContain(
      -1,
    );
    expect(
      headings(buildTraffic([segment(-1)], ORIGIN, project)),
    ).not.toContain(1);
  });

  it("skips classes without traffic and segments under a meter", () => {
    const rail = { ...segment(0), roadClass: "rail" };
    expect(buildTraffic([rail], ORIGIN, project).phase.length).toBe(0);
    expect(buildTraffic([segment(0, 0.5)], ORIGIN, project).phase.length).toBe(
      0,
    );
  });

  it("stores the positions relative to the origin", () => {
    const origin = new Vector3(5, 7, 0);
    const absolute = buildTraffic([segment(1)], ORIGIN, project);
    const relative = buildTraffic([segment(1)], origin, project);
    expect(relative.start[0]).toBeCloseTo(absolute.start[0] - 5);
    expect(relative.start[1]).toBeCloseTo(absolute.start[1] - 7);
  });
});
