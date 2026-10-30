import ThreeView, { type ViewContext } from "@navaramap/three";
import { Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StreetLightsPlugin } from "./StreetLightsPlugin";
import {
  loadRoadNetwork,
  tileCenter,
  tileCoordinate,
  type RoadNetwork,
} from "./streetTiles";
import {
  StreetTrafficMeshDesc,
  type StreetTrafficDescriptions,
} from "./StreetTrafficMeshDesc";

// Importing the real @navaramap/three touches WASM/os at module load, which
// fails in the test environment. The plugin needs `Plugin`, `MeshDesc` and
// `Color` as base classes and values, and `geodeticToVector3` for the car
// positions; a spherical earth is enough for what these tests check.
const R = 6378137;
const DEG = Math.PI / 180;

/* eslint-disable @typescript-eslint/no-extraneous-class */
vi.mock("@navaramap/three", () => ({
  default: class ThreeView {},
  Plugin: class Plugin {},
  MeshDesc: class MeshDesc {},
  Color: class Color {
    setStyle() {
      return this;
    }
  },
  geodeticToVector3: ({
    lat,
    lng,
    height,
  }: {
    lat: number;
    lng: number;
    height: number;
  }) =>
    new Vector3(
      (R + height) * Math.cos(lat * DEG) * Math.cos(lng * DEG),
      (R + height) * Math.cos(lat * DEG) * Math.sin(lng * DEG),
      (R + height) * Math.sin(lat * DEG),
    ),
}));
/* eslint-enable @typescript-eslint/no-extraneous-class */

// The tile fetch is the only network access; everything else runs as is.
vi.mock("./streetTiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./streetTiles")>()),
  loadRoadNetwork: vi.fn(),
}));

const TOKYO = { lng: 139.762, lat: 35.672 };
const TEMPLATE = "https://t/{z}/{x}/{y}.pbf";
const NETWORK: RoadNetwork = {
  roads: [
    {
      roadClass: "primary",
      oneway: 0,
      line: [
        [TOKYO.lng, TOKYO.lat],
        [TOKYO.lng + 0.003, TOKYO.lat],
      ],
    },
  ],
  tallBuildings: [{ lng: TOKYO.lng, lat: TOKYO.lat, height: 120 }],
};
// The plugin never reads the context.
const NO_CTX = {} as ViewContext;

type EvaluateFn = (feature: {
  properties?: Record<string, unknown>;
  batchId: number;
}) => Record<string, unknown>;
type LayerEvent = {
  evaluator: { evaluate: (fn: EvaluateFn, options?: unknown) => void };
};

/** A layer that records its handlers so a test can run the evaluator. */
const makeFakeLayer = () => {
  const handlers = new Map<string, (event: LayerEvent) => void>();
  return {
    on: vi.fn((event: string, handler: (event: LayerEvent) => void) => {
      handlers.set(event, handler);
    }),
    forceUpdate: vi.fn(),
    delete: vi.fn(),
    /** Runs the registered evaluator on one feature's properties. */
    evaluate: (properties: Record<string, unknown>) => {
      const handler = handlers.get("featureCreated");
      if (!handler) throw new Error("no evaluator registered");
      let result: Record<string, unknown> | undefined;
      handler({
        evaluator: {
          evaluate: (fn) => {
            result = fn({ properties, batchId: 0 });
          },
        },
      });
      return result;
    },
  };
};

const makeFakeView = () => {
  const layers: ReturnType<typeof makeFakeLayer>[] = [];
  const sources: { delete: ReturnType<typeof vi.fn> }[] = [];
  const meshes: {
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  }[] = [];
  const view = Object.assign(new ThreeView<StreetTrafficDescriptions>(), {
    registerMesh: vi.fn(),
    addSource: vi.fn(() => {
      const source = { delete: vi.fn() };
      sources.push(source);
      return source;
    }),
    addLayer: vi.fn((_description: unknown) => {
      const layer = makeFakeLayer();
      layers.push(layer);
      return layer;
    }),
    addMesh: vi.fn(() => {
      const mesh = { update: vi.fn(), delete: vi.fn() };
      meshes.push(mesh);
      return mesh;
    }),
  });
  return { view, layers, sources, meshes };
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A plugin following Tokyo with one tile loaded (radius 0). */
const started = async () => {
  const fake = makeFakeView();
  const plugin = new StreetLightsPlugin({ radius: 0 });
  await plugin.init(fake.view, NO_CTX);
  vi.mocked(loadRoadNetwork).mockResolvedValue(NETWORK);
  plugin.start({ tileTemplate: TEMPLATE, effectIds: ["bloom"] });
  plugin.follow(TOKYO.lng, TOKYO.lat);
  await flush();
  return { plugin, ...fake };
};

/** The center of the tile `dx` tiles east of Tokyo's. */
const tileEast = (dx: number) => {
  const tile = tileCoordinate(TOKYO.lng, TOKYO.lat);
  return tileCenter({ x: tile.x + dx, y: tile.y });
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("StreetLightsPlugin lifecycle", () => {
  it("throws before init() and before start()", async () => {
    const { view } = makeFakeView();
    const source = view.addSource({
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    const plugin = new StreetLightsPlugin();
    expect(() => plugin.addRoads(source)).toThrow(/view\.init\(\)/);
    expect(() => plugin.start({ tileTemplate: TEMPLATE })).toThrow(
      /view\.init\(\)/,
    );

    await plugin.init(view, NO_CTX);
    expect(() => plugin.follow(TOKYO.lng, TOKYO.lat)).toThrow(/start\(\)/);
  });

  it("registers the traffic mesh on init()", async () => {
    const { view } = makeFakeView();
    const plugin = new StreetLightsPlugin();
    await plugin.init(view, NO_CTX);
    expect(view.registerMesh).toHaveBeenCalledWith(
      "streetTraffic",
      StreetTrafficMeshDesc,
    );
  });
});

describe("StreetLightsPlugin.addRoads", () => {
  it("adds a clamped polyline layer sized per road class", async () => {
    const { view, layers } = makeFakeView();
    const plugin = new StreetLightsPlugin();
    await plugin.init(view, NO_CTX);
    const source = view.addSource({
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    plugin.addRoads(source);

    expect(view.addLayer).toHaveBeenCalledWith({
      type: "vector",
      source,
      sourceLayers: ["transportation"],
      polyline: expect.objectContaining({ width: 1, clampToGround: true }),
    });
    const [surface] = layers;
    expect(surface.evaluate({ class: "primary" })).toEqual({
      show: true,
      width: 4.5,
    });
    expect(surface.evaluate({ class: "rail" })).toEqual({ show: false });

    plugin.setVisible(false);
    expect(surface.forceUpdate).toHaveBeenCalledTimes(1);
    expect(surface.evaluate({ class: "primary" })).toEqual({ show: false });
    plugin.setVisible(false);
    expect(surface.forceUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("StreetLightsPlugin streaming", () => {
  it("adds the lights and traffic of the tile under the followed position", async () => {
    const { view, layers, meshes } = await started();

    expect(loadRoadNetwork).toHaveBeenCalledWith(
      TEMPLATE,
      tileCoordinate(TOKYO.lng, TOKYO.lat),
      expect.any(AbortSignal),
    );
    // One source each for the lamps and the beacons.
    expect(view.addSource).toHaveBeenCalledTimes(2);
    expect(view.addSource).toHaveBeenCalledWith({
      type: "geojson",
      data: expect.objectContaining({ type: "FeatureCollection" }),
    });
    expect(view.addLayer).toHaveBeenCalledTimes(2);
    const [lampsDesc, beaconsDesc] = vi
      .mocked(view.addLayer)
      .mock.calls.map(([desc]) => desc);
    expect(lampsDesc).toMatchObject({
      point: { clampToGround: true, sizeInMeters: true, effectIds: ["bloom"] },
    });
    expect(beaconsDesc).toMatchObject({
      point: { clampToGround: false, sizeInMeters: true, effectIds: ["bloom"] },
    });

    const center = tileCenter(tileCoordinate(TOKYO.lng, TOKYO.lat));
    expect(view.addMesh).toHaveBeenCalledWith({
      streetTraffic: {
        data: expect.objectContaining({ start: expect.any(Float32Array) }),
      },
      position: expect.objectContaining({
        z: (R + 0) * Math.sin(center.lat * DEG),
      }),
      visible: true,
    });
    expect(meshes).toHaveLength(1);

    const [lamps, beacons] = layers;
    expect(lamps.evaluate({ kind: "lamp" })).toMatchObject({
      show: true,
      size: 3,
    });
    expect(lamps.evaluate({ kind: "warm" })).toMatchObject({
      show: true,
      size: 2.5,
    });
    expect(lamps.evaluate({ kind: "other" })).toEqual({ show: false });
    expect(beacons.evaluate({ height: 122 })).toEqual({
      show: true,
      height: 122,
    });
  });

  it("drops a tile once the followed position leaves it", async () => {
    const { plugin, view, layers, sources, meshes } = await started();

    const east = tileEast(2);
    plugin.follow(east.lng, east.lat);
    await flush();

    expect(layers[0].delete).toHaveBeenCalledTimes(1);
    expect(layers[1].delete).toHaveBeenCalledTimes(1);
    expect(sources[0].delete).toHaveBeenCalledTimes(1);
    expect(sources[1].delete).toHaveBeenCalledTimes(1);
    expect(meshes[0].delete).toHaveBeenCalledTimes(1);
    expect(view.addSource).toHaveBeenCalledTimes(4);
  });

  it("turns the lights off and on through the evaluators and the traffic visibility", async () => {
    const { plugin, view, layers, meshes } = await started();
    const [lamps, beacons] = layers;

    plugin.setLightsOn(false);
    expect(lamps.forceUpdate).toHaveBeenCalledTimes(1);
    expect(beacons.forceUpdate).toHaveBeenCalledTimes(1);
    expect(meshes[0].update).toHaveBeenCalledWith({ visible: false });
    expect(lamps.evaluate({ kind: "lamp" })).toEqual({ show: false });

    plugin.setLightsOn(false);
    expect(lamps.forceUpdate).toHaveBeenCalledTimes(1);

    // A tile that streams in while the lights are off starts dark.
    const east = tileEast(1);
    plugin.follow(east.lng, east.lat);
    await flush();
    expect(view.addMesh).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: false }),
    );

    plugin.setLightsOn(true);
    expect(meshes[1].update).toHaveBeenCalledWith({ visible: true });
  });

  it("passes traffic updates to the loaded tiles and the ones to come", async () => {
    const { plugin, view, meshes } = await started();

    plugin.update({ traffic: { speed: 2 } });
    expect(meshes[0].update).toHaveBeenCalledWith({
      streetTraffic: { speed: 2 },
    });

    const east = tileEast(1);
    plugin.follow(east.lng, east.lat);
    await flush();
    expect(view.addMesh).toHaveBeenLastCalledWith(
      expect.objectContaining({
        streetTraffic: expect.objectContaining({ speed: 2 }),
      }),
    );
  });

  it("start() again drops the tiles of the previous start", async () => {
    const { plugin, sources } = await started();
    plugin.start({ tileTemplate: TEMPLATE });
    expect(sources[0].delete).toHaveBeenCalledTimes(1);
  });

  it("dispose() drops everything and stops the tiles still loading", async () => {
    const { plugin, view, layers, sources, meshes } = await started();
    const source = view.addSource({
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    plugin.addRoads(source);

    // A tile still loading when the plugin goes away.
    let settle: (network: RoadNetwork) => void = () => {};
    vi.mocked(loadRoadNetwork).mockImplementationOnce(
      () =>
        new Promise<RoadNetwork>((resolve) => {
          settle = resolve;
        }),
    );
    const east = tileEast(1);
    plugin.follow(east.lng, east.lat);
    const signal = vi.mocked(loadRoadNetwork).mock.lastCall?.[2];

    plugin.dispose();

    expect(signal?.aborted).toBe(true);
    for (const layer of layers) expect(layer.delete).toHaveBeenCalledTimes(1);
    expect(sources[0].delete).toHaveBeenCalledTimes(1);
    expect(sources[1].delete).toHaveBeenCalledTimes(1);
    expect(meshes[0].delete).toHaveBeenCalledTimes(1);

    const added = vi.mocked(view.addSource).mock.calls.length;
    settle(NETWORK);
    await flush();
    expect(view.addSource).toHaveBeenCalledTimes(added);
    expect(() => plugin.addRoads(source)).toThrow(/view\.init\(\)/);
  });
});
