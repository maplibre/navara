import type { Geometry, Position } from "geojson";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROADS } from "./roads";
import { TEST_BUILDINGS, TEST_ROADS, TEST_TEMPLATE } from "./test-utils";
import {
  chebyshev,
  createTileStreamer,
  loadRoadNetwork,
  readRoads,
  readRoofs,
  readTileRoads,
  readTileRoofs,
  tileCenter,
  tileCoordinate,
  tileKey,
  type Road,
  type Roof,
  type TileCoordinate,
  type TileLayer,
} from "./tiles";

const TOKYO = { lng: 139.762, lat: 35.672 };
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
      TEST_ROADS,
      out,
    );
    expect(out).toEqual([
      {
        style: ROADS.primary,
        oneway: 1,
        line: [
          [0, 0],
          [1, 1],
        ],
      },
      {
        style: ROADS.minor,
        oneway: 0,
        line: [
          [0, 0],
          [1, 0],
        ],
      },
      {
        style: ROADS.minor,
        oneway: 0,
        line: [
          [0, 1],
          [1, 1],
        ],
      },
    ]);
  });
});

describe("readRoads properties", () => {
  it("shows the reader only the listed properties, as the road layer does", () => {
    const seen: Record<string, unknown>[] = [];
    const out: Road[] = [];
    readRoads(
      layerOf([
        {
          properties: { highway: "main", access: "private", name: "x" },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      ]),
      TILE,
      {
        evaluateFeature: (properties) => {
          seen.push(properties);
          return { roadClass: "primary" };
        },
        filterFeatureProperties: ["highway", "oneway"],
      },
      out,
    );
    // Listed names only, each present even when the feature lacks it.
    expect(seen).toEqual([{ highway: "main", oneway: undefined }]);
  });
});

describe("road classes", () => {
  it("give each road the style of the class its reader picks", () => {
    const line = (
      kind: string,
    ): { properties: Record<string, unknown>; geometry: Geometry } => ({
      properties: { kind },
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });
    const out: Road[] = [];
    readRoads(
      layerOf([line("main"), line("local"), line("footway")]),
      TILE,
      {
        evaluateFeature: ({ kind }) =>
          kind === "main"
            ? { roadClass: "primary", oneway: 1 }
            : kind === "local"
              ? { roadClass: "minor" }
              : undefined,
        filterFeatureProperties: undefined,
      },
      out,
    );
    expect(out.map(({ style, oneway }) => ({ style, oneway }))).toEqual([
      { style: ROADS.primary, oneway: 1 },
      { style: ROADS.minor, oneway: 0 },
    ]);
  });
});

describe("readRoofs", () => {
  it("reads the roof center of every building the reader gives a height", () => {
    const square = (x: number, y: number): Position[][] => [
      [
        [x, y],
        [x + 2, y],
        [x + 2, y + 2],
        [x, y + 2],
        [x, y],
      ],
    ];
    const out: Roof[] = [];
    readRoofs(
      layerOf([
        {
          properties: { render_height: 120 },
          geometry: { type: "Polygon", coordinates: square(0, 0) },
        },
        {
          properties: { render_height: Number.NaN },
          geometry: { type: "Polygon", coordinates: square(0, 0) },
        },
        {
          properties: { render_height: 120 },
          geometry: { type: "Polygon", coordinates: [[[5, 5]]] },
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
      TEST_BUILDINGS.evaluateFeature,
      out,
    );
    expect(out).toEqual([
      { lng: 1, lat: 1, height: 120 },
      { lng: 1, lat: 1, height: 100 },
      { lng: 11, lat: 11, height: 100 },
    ]);
  });
});

const line = (properties: Record<string, unknown>) => ({
  properties,
  geometry: {
    type: "LineString" as const,
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  },
});
const square = (properties: Record<string, unknown>) => ({
  properties,
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  },
});

describe("readTileRoads and readTileRoofs", () => {
  it("read every listed source layer the tile has, in order", () => {
    const layers = {
      major: layerOf([line({ class: "primary" })]),
      minor: layerOf([line({ class: "minor" }), line({ class: "rail" })]),
      building: layerOf([square({ render_height: 120 })]),
    };
    const roads = readTileRoads(layers, TILE, {
      ...TEST_ROADS,
      template: TEST_TEMPLATE,
      sourceLayers: ["major", "missing", "minor"],
    });
    expect(roads.map(({ style }) => style)).toEqual([
      ROADS.primary,
      ROADS.minor,
    ]);

    const roofs = readTileRoofs(layers, TILE, {
      ...TEST_BUILDINGS,
      template: TEST_TEMPLATE,
      sourceLayers: ["building", "missing"],
    });
    expect(roofs).toEqual([{ lng: 1, lat: 1, height: 120 }]);
  });
});

describe("loadRoadNetwork", () => {
  const reading = (buildingTemplate = TEST_TEMPLATE) => ({
    roads: { ...TEST_ROADS, template: TEST_TEMPLATE },
    buildings: { ...TEST_BUILDINGS, template: buildingTemplate },
  });

  it("reads a tile the server does not have as empty", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { signal } = new AbortController();

    await expect(
      loadRoadNetwork(reading(), { x: 1, y: 2 }, signal),
    ).resolves.toEqual({ roads: [], roofs: [] });
    expect(fetchMock).toHaveBeenCalledWith("https://t/14/1/2.pbf", { signal });
  });

  it("rejects a tile the server fails to serve", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    const { signal } = new AbortController();

    await expect(loadRoadNetwork(reading(), TILE, signal)).rejects.toThrow(
      "failed (500)",
    );
  });

  it("fetches a tile once per template", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { signal } = new AbortController();

    await loadRoadNetwork(reading(), TILE, signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await loadRoadNetwork(reading("https://b/{z}/{x}/{y}.pbf"), TILE, signal);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith("https://b/14/0/0.pbf", {
      signal,
    });
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

  it("keeps a tile asked for again while its earlier, aborted load settles", async () => {
    const loads: { signal: AbortSignal; resolve: () => void }[] = [];
    const add = vi.fn(
      (tile: TileCoordinate, signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          loads.push({ signal, resolve: () => resolve(tileKey(tile)) });
        }),
    );
    const streamer = createTileStreamer(0, add, vi.fn());
    const center = tileCoordinate(TOKYO.lng, TOKYO.lat);
    const far = tileCenter({ x: center.x + 10, y: center.y });

    streamer.update(TOKYO.lng, TOKYO.lat); // loads[0]: the tile
    streamer.update(far.lng, far.lat); // loads[0] aborted, loads[1]: far
    streamer.update(TOKYO.lng, TOKYO.lat); // loads[2]: the tile again
    loads[0].resolve(); // the aborted load settles late
    await flush();

    // The second load of the tile is still tracked, so dispose aborts it.
    streamer.dispose();
    expect(loads[2].signal.aborted).toBe(true);
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
