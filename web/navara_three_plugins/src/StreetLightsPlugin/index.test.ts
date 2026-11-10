import ThreeView, { type ViewContext } from "@navaramap/three";
import { Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROADS } from "./roads";
import {
  StreetTrafficMeshDesc,
  type StreetTrafficDescriptions,
} from "./StreetTrafficMeshDesc";
import { TEST_SCHEMA } from "./test-utils";
import {
  loadRoadNetwork,
  tileCenter,
  tileCoordinate,
  type RoadNetwork,
} from "./tiles";

import { StreetLightsPlugin } from "./index";

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
vi.mock("./tiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tiles")>()),
  loadRoadNetwork: vi.fn(),
}));

const TOKYO = { lng: 139.762, lat: 35.672 };
const TEMPLATE = "https://t/{z}/{x}/{y}.pbf";
const NETWORK: RoadNetwork = {
  roads: [
    {
      style: ROADS.primary,
      oneway: 0,
      line: [
        [TOKYO.lng, TOKYO.lat],
        [TOKYO.lng + 0.003, TOKYO.lat],
      ],
    },
  ],
  roofs: [{ lng: TOKYO.lng, lat: TOKYO.lat, height: 120 }],
};
// ViewContext has private members, so no object literal can satisfy it
// structurally. The cast is the repo's pattern for a context a test never
// reads (navara_three core/MeshDesc.test.ts, EffectDesc.test.ts and
// navara_maplibre_style MapLibreStylePlugin.test.ts); the plugin reads none
// of it.
const NO_CTX: ViewContext = {} as ViewContext;

type EvaluateFn = (feature: {
  properties?: Record<string, unknown>;
  batchId: number;
}) => Record<string, unknown>;
type LayerEvent = {
  evaluator: {
    evaluate: (fn: EvaluateFn, options?: { filters?: string[] }) => void;
  };
};

/** A layer that records its handlers so a test can run the evaluator. */
const makeFakeLayer = () => {
  const handlers = new Map<string, (event: LayerEvent) => void>();
  let filters: string[] | undefined;
  let onDeleted: () => void = () => {};
  return {
    on: vi.fn((event: string, handler: (event: LayerEvent) => void) => {
      handlers.set(event, handler);
    }),
    off: vi.fn(),
    once: vi.fn((event: string, handler: () => void) => {
      if (event === "deleted") onDeleted = handler;
    }),
    forceUpdate: vi.fn(),
    delete: vi.fn(() => onDeleted()),
    /** The `filters` the registered evaluator asked for. */
    get filters() {
      return filters;
    },
    /** Runs the registered evaluator on one feature's properties. */
    evaluate(properties: Record<string, unknown>) {
      const handler = handlers.get("featureCreated");
      if (!handler) throw new Error("no evaluator registered");
      let result: Record<string, unknown> | undefined;
      handler({
        evaluator: {
          evaluate: (fn, options) => {
            filters = options?.filters;
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
  const plugin = new StreetLightsPlugin({ radius: 0, ...TEST_SCHEMA });
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
    const roads = view.addLayer({ type: "vector", source: "roads" });
    const plugin = new StreetLightsPlugin(TEST_SCHEMA);
    expect(() => plugin.addRoads(roads)).toThrow(/view\.init\(\)/);
    expect(() => plugin.start({ tileTemplate: TEMPLATE })).toThrow(
      /view\.init\(\)/,
    );

    await plugin.init(view, NO_CTX);
    expect(() => plugin.follow(TOKYO.lng, TOKYO.lat)).toThrow(/start\(\)/);
  });

  it("registers the traffic mesh on init()", async () => {
    const { view } = makeFakeView();
    const plugin = new StreetLightsPlugin(TEST_SCHEMA);
    await plugin.init(view, NO_CTX);
    expect(view.registerMesh).toHaveBeenCalledWith(
      "streetTraffic",
      StreetTrafficMeshDesc,
    );
  });
});

describe("StreetLightsPlugin.addRoads", () => {
  it("hides the features without lights and sizes the rest per road class", async () => {
    const { view, layers } = makeFakeView();
    const plugin = new StreetLightsPlugin(TEST_SCHEMA);
    await plugin.init(view, NO_CTX);
    const roads = view.addLayer({ type: "vector", source: "roads" });

    plugin.addRoads(roads);

    const [surface] = layers;
    expect(surface.on).toHaveBeenCalledWith(
      "featureCreated",
      expect.any(Function),
    );
    expect(surface.on).toHaveBeenCalledWith(
      "featureUpdated",
      expect.any(Function),
    );
    expect(surface.evaluate({ class: "primary" })).toEqual({
      show: true,
      width: 4.5,
    });
    expect(surface.evaluate({ class: "rail" })).toEqual({ show: false });
    expect(surface.filters).toEqual(["class", "oneway"]);
    // Features the layer held before addRoads() are re-evaluated.
    expect(surface.forceUpdate).toHaveBeenCalledTimes(1);

    plugin.setVisible(false);
    expect(surface.forceUpdate).toHaveBeenCalledTimes(2);
    expect(surface.evaluate({ class: "primary" })).toEqual({ show: false });
    plugin.setVisible(false);
    expect(surface.forceUpdate).toHaveBeenCalledTimes(2);

    // Giving the same layer again adds no second evaluator.
    plugin.addRoads(roads);
    expect(surface.on).toHaveBeenCalledTimes(2);

    // Deleted by its creator: the plugin lets go of it.
    roads.delete();
    plugin.dispose();
    expect(surface.delete).toHaveBeenCalledTimes(1);
    expect(surface.off).not.toHaveBeenCalled();
  });

  it("shows the reader only its listed properties, or all without a list", async () => {
    const { view, layers } = makeFakeView();
    const plugin = new StreetLightsPlugin(TEST_SCHEMA);
    await plugin.init(view, NO_CTX);
    plugin.addRoads(view.addLayer({ type: "vector", source: "roads" }));
    layers[0].evaluate({ class: "primary" });
    expect(layers[0].filters).toEqual(["class", "oneway"]);

    const all = new StreetLightsPlugin({
      ...TEST_SCHEMA,
      roads: {
        sourceLayers: ["roads"],
        evaluateFeature: () => ({ roadClass: "minor" }),
      },
    });
    await all.init(view, NO_CTX);
    all.addRoads(view.addLayer({ type: "vector", source: "roads" }));
    layers[1].evaluate({ anything: 1 });
    expect(layers[1].filters).toBeUndefined();
  });

  it("reads the roads through the configured reader", async () => {
    const { view, layers } = makeFakeView();
    const plugin = new StreetLightsPlugin({
      roads: {
        sourceLayers: ["roads"],
        evaluateFeature: (properties) =>
          properties.highway === "main" ? { roadClass: "primary" } : undefined,
      },
      buildings: {
        sourceLayers: ["buildings"],
        evaluateFeature: (properties) =>
          typeof properties.height === "number" ? properties.height : undefined,
      },
    });
    await plugin.init(view, NO_CTX);
    plugin.addRoads(view.addLayer({ type: "vector", source: "roads" }));

    const [surface] = layers;
    expect(surface.evaluate({ highway: "main" })).toEqual({
      show: true,
      width: 4.5,
    });
    expect(surface.evaluate({ class: "primary" })).toEqual({ show: false });

    vi.mocked(loadRoadNetwork).mockResolvedValue(NETWORK);
    plugin.start({ tileTemplate: TEMPLATE });
    plugin.follow(TOKYO.lng, TOKYO.lat);
    expect(loadRoadNetwork).toHaveBeenCalledWith(
      TEMPLATE,
      tileCoordinate(TOKYO.lng, TOKYO.lat),
      expect.objectContaining({
        roads: expect.objectContaining({ sourceLayers: ["roads"] }),
        buildings: expect.objectContaining({ sourceLayers: ["buildings"] }),
      }),
      expect.any(AbortSignal),
    );
  });
});

describe("StreetLightsPlugin streaming", () => {
  it("adds the lights and traffic of the tile under the followed position", async () => {
    const { view, layers, meshes } = await started();

    expect(loadRoadNetwork).toHaveBeenCalledWith(
      TEMPLATE,
      tileCoordinate(TOKYO.lng, TOKYO.lat),
      TEST_SCHEMA,
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
    // Plain lamps keep the material's look; warm ones are recolored.
    expect(lamps.evaluate({ kind: "lamp" })).toEqual({ show: true });
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

  it("hides one part on its own, or all of them without a part", async () => {
    const { plugin, view, layers, meshes } = await started();
    const roads = view.addLayer({ type: "vector", source: "roads" });
    plugin.addRoads(roads);
    const [lamps, beacons, surface] = layers;
    vi.mocked(surface.forceUpdate).mockClear();

    plugin.setVisible(false, "traffic");
    expect(meshes[0].update).toHaveBeenCalledWith({ visible: false });
    expect(lamps.evaluate({ kind: "lamp" })).toEqual({ show: true });
    // Only the layers of the changed part are re-evaluated.
    expect(lamps.forceUpdate).not.toHaveBeenCalled();
    expect(beacons.forceUpdate).not.toHaveBeenCalled();
    expect(surface.forceUpdate).not.toHaveBeenCalled();

    plugin.setVisible(false, "lamps");
    expect(lamps.evaluate({ kind: "lamp" })).toEqual({ show: false });
    expect(beacons.evaluate({ height: 122 })).toMatchObject({ show: true });

    // Without a part, every part follows: the last call wins.
    plugin.setVisible(true);
    expect(meshes[0].update).toHaveBeenLastCalledWith({ visible: true });
    expect(lamps.evaluate({ kind: "lamp" })).toEqual({ show: true });
    expect(surface.forceUpdate).not.toHaveBeenCalled();

    plugin.setVisible(false, "roads");
    expect(surface.forceUpdate).toHaveBeenCalledTimes(1);
    expect(surface.evaluate({ class: "primary" })).toEqual({ show: false });

    // A tile that streams in later starts with the part hidden.
    plugin.setVisible(false, "traffic");
    const east = tileEast(1);
    plugin.follow(east.lng, east.lat);
    await flush();
    expect(view.addMesh).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: false }),
    );
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

  it("builds nothing for a tile whose load was aborted after it arrived", async () => {
    const { plugin, view } = await started();
    let arrive: (network: RoadNetwork) => void = () => {};
    vi.mocked(loadRoadNetwork).mockImplementationOnce(
      () =>
        new Promise<RoadNetwork>((resolve) => {
          arrive = resolve;
        }),
    );
    const east = tileEast(1);
    plugin.follow(east.lng, east.lat);
    const added = vi.mocked(view.addSource).mock.calls.length;

    // Moving on aborts the load; the data still arrives afterwards.
    const far = tileEast(5);
    vi.mocked(loadRoadNetwork).mockImplementation(() => new Promise(() => {}));
    plugin.follow(far.lng, far.lat);
    arrive(NETWORK);
    await flush();
    expect(view.addSource).toHaveBeenCalledTimes(added);
  });

  it("dispose() drops everything and stops the tiles still loading", async () => {
    const { plugin, view, layers, sources, meshes } = await started();
    const roads = view.addLayer({ type: "vector", source: "roads" });
    plugin.addRoads(roads);

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
    const signal = vi.mocked(loadRoadNetwork).mock.lastCall?.[3];

    plugin.dispose();

    expect(signal?.aborted).toBe(true);
    const [lamps, beacons, surface] = layers;
    expect(lamps.delete).toHaveBeenCalledTimes(1);
    expect(beacons.delete).toHaveBeenCalledTimes(1);
    // The road layer stays the caller's: detached, not deleted.
    expect(surface.delete).not.toHaveBeenCalled();
    expect(surface.off).toHaveBeenCalledTimes(3);
    expect(sources[0].delete).toHaveBeenCalledTimes(1);
    expect(sources[1].delete).toHaveBeenCalledTimes(1);
    expect(meshes[0].delete).toHaveBeenCalledTimes(1);

    const added = vi.mocked(view.addSource).mock.calls.length;
    settle(NETWORK);
    await flush();
    expect(view.addSource).toHaveBeenCalledTimes(added);
    expect(() => plugin.addRoads(roads)).toThrow(/view\.init\(\)/);
  });
});
