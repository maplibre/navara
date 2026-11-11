import ThreeView, { type ViewContext } from "@navaramap/three";
import { Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TileJsonPlugin } from "../TileJsonPlugin";

import { ROADS } from "./roads";
import {
  StreetTrafficMeshDesc,
  type StreetTrafficDescriptions,
} from "./StreetTrafficMeshDesc";
import { TEST_BUILDINGS, TEST_ROADS, TEST_TEMPLATE } from "./test-utils";
import {
  loadRoadNetwork,
  tileCenter,
  tileCoordinate,
  type RoadNetwork,
} from "./tiles";

import { StreetLightsPlugin, type StreetLightsStartOptions } from "./index";

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

// A TileJSON resolver whose documents list `<url>/{z}/{x}/{y}.pbf`.
vi.mock("../TileJsonPlugin", () => {
  type Loaded = (event: {
    source: unknown;
    tilejson: { tiles: string[] };
  }) => void;
  class TileJsonPlugin {
    private readonly listeners = new Set<Loaded>();
    async init() {}
    dispose() {
      this.listeners.clear();
    }
    on(_event: string, listener: Loaded) {
      this.listeners.add(listener);
    }
    off(_event: string, listener: Loaded) {
      this.listeners.delete(listener);
    }
    async addSource({ url }: { url: string }) {
      const source = { delete: vi.fn() };
      for (const listener of this.listeners) {
        listener({ source, tilejson: { tiles: [`${url}/{z}/{x}/{y}.pbf`] } });
      }
      return source;
    }
  }
  return { TileJsonPlugin };
});

const TOKYO = { lng: 139.762, lat: 35.672 };
const START: StreetLightsStartOptions = {
  roads: TEST_ROADS,
  buildings: TEST_BUILDINGS,
  radius: 0,
  effectIds: ["bloom"],
};
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
// structurally; the plugin reads none of it.
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

/**
 * A plugin following Tokyo with one tile loaded (radius 0). The first source
 * and layer are the road surface's; the tile's lamps and beacons follow.
 */
const started = async () => {
  const fake = makeFakeView();
  const plugin = new StreetLightsPlugin();
  await plugin.init(fake.view, NO_CTX);
  vi.mocked(loadRoadNetwork).mockResolvedValue(NETWORK);
  await plugin.start(START);
  plugin.follow(TOKYO.lng, TOKYO.lat);
  await flush();
  const [surface, lamps, beacons] = fake.layers;
  return { plugin, surface, lamps, beacons, ...fake };
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
    const plugin = new StreetLightsPlugin();
    await expect(plugin.start(START)).rejects.toThrow(/view\.init\(\)/);

    await plugin.init(view, NO_CTX);
    expect(() => plugin.follow(TOKYO.lng, TOKYO.lat)).toThrow(/start\(\)/);
  });

  it("registers the traffic mesh and readies the TileJSON resolver on init()", async () => {
    const { view } = makeFakeView();
    const tileJsonPlugin = new TileJsonPlugin();
    const initTileJson = vi.spyOn(tileJsonPlugin, "init");
    const plugin = new StreetLightsPlugin({ tileJsonPlugin });
    await plugin.init(view, NO_CTX);
    expect(view.registerMesh).toHaveBeenCalledWith(
      "streetTraffic",
      StreetTrafficMeshDesc,
    );
    expect(initTileJson).toHaveBeenCalledWith(view, NO_CTX);
  });
});

describe("StreetLightsPlugin.start", () => {
  it("opens one source for a shared tile set and draws the road surface on it", async () => {
    const { view, surface } = await started();

    expect(view.addSource).toHaveBeenNthCalledWith(1, {
      type: "vector-tile",
      url: TEST_TEMPLATE,
    });
    expect(vi.mocked(view.addLayer).mock.calls[0][0]).toMatchObject({
      type: "vector",
      sourceLayers: ["transportation"],
    });
    expect(loadRoadNetwork).toHaveBeenCalledWith(
      {
        roads: expect.objectContaining({
          template: TEST_TEMPLATE,
          sourceLayers: ["transportation"],
        }),
        buildings: expect.objectContaining({
          template: TEST_TEMPLATE,
          sourceLayers: ["building"],
        }),
      },
      tileCoordinate(TOKYO.lng, TOKYO.lat),
      expect.any(AbortSignal),
    );

    expect(surface.evaluate({ class: "primary" })).toEqual({
      show: true,
      width: 4.5,
    });
    expect(surface.evaluate({ class: "rail" })).toEqual({ show: false });
    expect(surface.filters).toEqual(["class", "oneway"]);
  });

  it("gives the road surface the caller's polyline material", async () => {
    const { view } = makeFakeView();
    const plugin = new StreetLightsPlugin();
    await plugin.init(view, NO_CTX);
    await plugin.start({
      ...START,
      roads: { ...TEST_ROADS, polyline: { clampToGround: true } },
    });
    expect(vi.mocked(view.addLayer).mock.calls[0][0]).toMatchObject({
      polyline: { clampToGround: true },
    });
  });

  it("shows the reader all properties without a filter", async () => {
    const { view, layers } = makeFakeView();
    const plugin = new StreetLightsPlugin();
    await plugin.init(view, NO_CTX);
    await plugin.start({
      ...START,
      roads: {
        sourceType: "vector-tile",
        sourceUrl: TEST_TEMPLATE,
        sourceLayers: ["roads"],
        evaluateFeature: () => ({ roadClass: "minor" }),
      },
    });
    layers[0].evaluate({ anything: 1 });
    expect(layers[0].filters).toBeUndefined();
  });

  it("reads buildings from their own tile set without an engine source", async () => {
    const { view } = makeFakeView();
    const plugin = new StreetLightsPlugin();
    await plugin.init(view, NO_CTX);
    await plugin.start({
      ...START,
      buildings: { ...TEST_BUILDINGS, sourceUrl: "https://b/{z}/{x}/{y}" },
    });
    plugin.follow(TOKYO.lng, TOKYO.lat);
    expect(view.addSource).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(loadRoadNetwork).mock.lastCall?.[0].buildings,
    ).toMatchObject({ template: "https://b/{z}/{x}/{y}" });
  });

  it("resolves a TileJSON source once and streams from its tile URL", async () => {
    const { view } = makeFakeView();
    const tileJsonPlugin = new TileJsonPlugin();
    const addSource = vi.spyOn(tileJsonPlugin, "addSource");
    const disposeTileJson = vi.spyOn(tileJsonPlugin, "dispose");
    const plugin = new StreetLightsPlugin({ tileJsonPlugin });
    await plugin.init(view, NO_CTX);
    const url = "https://tiles.example/planet";
    await plugin.start({
      ...START,
      roads: { ...TEST_ROADS, sourceType: "tilejson", sourceUrl: url },
      buildings: { ...TEST_BUILDINGS, sourceType: "tilejson", sourceUrl: url },
    });
    plugin.follow(TOKYO.lng, TOKYO.lat);

    expect(addSource).toHaveBeenCalledTimes(1);
    expect(addSource).toHaveBeenCalledWith({ type: "vector-tile", url });
    expect(view.addSource).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "vector-tile" }),
    );
    expect(vi.mocked(loadRoadNetwork).mock.lastCall?.[0]).toMatchObject({
      roads: { template: `${url}/{z}/{x}/{y}.pbf` },
      buildings: { template: `${url}/{z}/{x}/{y}.pbf` },
    });

    // A resolver passed in stays the caller's.
    plugin.dispose();
    expect(disposeTileJson).not.toHaveBeenCalled();
  });

  /** A started plugin whose next TileJSON source opens only on `open()`. */
  const startedWithDeferredTileJson = async () => {
    const fake = makeFakeView();
    const tileJson = new TileJsonPlugin();
    const plugin = new StreetLightsPlugin({ tileJsonPlugin: tileJson });
    await plugin.init(fake.view, NO_CTX);
    vi.mocked(loadRoadNetwork).mockResolvedValue(NETWORK);
    await plugin.start(START);
    plugin.follow(TOKYO.lng, TOKYO.lat);
    await flush();

    let open: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      open = resolve;
    });
    const addSource = vi
      .spyOn(tileJson, "addSource")
      .mockImplementationOnce(async (description) => {
        await pending;
        return TileJsonPlugin.prototype.addSource.call(tileJson, description);
      });
    const url = "https://tiles.example/planet";
    const tileJsonStart: StreetLightsStartOptions = {
      ...START,
      roads: { ...TEST_ROADS, sourceType: "tilejson", sourceUrl: url },
      buildings: { ...TEST_BUILDINGS, sourceType: "tilejson", sourceUrl: url },
    };
    const [surface, lamps] = fake.layers;
    return { plugin, surface, lamps, addSource, tileJsonStart, open, ...fake };
  };

  it("keeps the previous start serving until the new sources are open", async () => {
    const { plugin, surface, lamps, sources, layers, tileJsonStart, open } =
      await startedWithDeferredTileJson();

    const next = plugin.start(tileJsonStart);
    await flush();
    expect(surface.delete).not.toHaveBeenCalled();
    expect(() => plugin.follow(TOKYO.lng, TOKYO.lat)).not.toThrow();

    open();
    await next;
    expect(surface.delete).toHaveBeenCalledTimes(1);
    expect(lamps.delete).toHaveBeenCalledTimes(1);
    expect(sources[0].delete).toHaveBeenCalledTimes(1);
    expect(layers).toHaveLength(4);
  });

  it("opens nothing for a start() overtaken by dispose() or another start()", async () => {
    const { plugin, view, layers, addSource, tileJsonStart, open } =
      await startedWithDeferredTileJson();

    const overtaken = plugin.start(tileJsonStart);
    await flush();
    await plugin.start(START);
    const layersAfterSecond = layers.length;
    open();
    await overtaken;
    const opened = await addSource.mock.results[0].value;
    expect(opened.delete).toHaveBeenCalledTimes(1);
    expect(layers).toHaveLength(layersAfterSecond);

    const disposed = plugin.start(START);
    plugin.dispose();
    await disposed;
    expect(view.addLayer).toHaveBeenCalledTimes(layersAfterSecond);
  });

  it("closes the road source when the buildings source fails to open", async () => {
    const { view, sources } = makeFakeView();
    const tileJson = new TileJsonPlugin();
    vi.spyOn(tileJson, "addSource").mockRejectedValueOnce(new Error("boom"));
    const plugin = new StreetLightsPlugin({ tileJsonPlugin: tileJson });
    await plugin.init(view, NO_CTX);

    await expect(
      plugin.start({
        ...START,
        buildings: {
          ...TEST_BUILDINGS,
          sourceType: "tilejson",
          sourceUrl: "https://tiles.example/buildings",
        },
      }),
    ).rejects.toThrow("boom");
    expect(sources).toHaveLength(1);
    expect(sources[0].delete).toHaveBeenCalledTimes(1);
    expect(view.addLayer).not.toHaveBeenCalled();
  });

  it("opens a source per TileJSON document and drops both on dispose()", async () => {
    const { view } = makeFakeView();
    const tileJson = new TileJsonPlugin();
    const addSource = vi.spyOn(tileJson, "addSource");
    const plugin = new StreetLightsPlugin({ tileJsonPlugin: tileJson });
    await plugin.init(view, NO_CTX);
    await plugin.start({
      ...START,
      roads: { ...TEST_ROADS, sourceType: "tilejson", sourceUrl: "https://a" },
      buildings: {
        ...TEST_BUILDINGS,
        sourceType: "tilejson",
        sourceUrl: "https://b",
      },
    });
    plugin.follow(TOKYO.lng, TOKYO.lat);
    expect(addSource).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadRoadNetwork).mock.lastCall?.[0]).toMatchObject({
      roads: { template: "https://a/{z}/{x}/{y}.pbf" },
      buildings: { template: "https://b/{z}/{x}/{y}.pbf" },
    });

    plugin.dispose();
    for (const { value } of addSource.mock.results) {
      expect((await value).delete).toHaveBeenCalledTimes(1);
    }
  });

  it("opens nothing when its own resolver is disposed while a document loads", async () => {
    const { view } = makeFakeView();
    const original = TileJsonPlugin.prototype.addSource;
    let open: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      open = resolve;
    });
    const addSource = vi
      .spyOn(TileJsonPlugin.prototype, "addSource")
      .mockImplementationOnce(async function (this: TileJsonPlugin, desc) {
        await pending;
        return original.call(this, desc);
      });
    const plugin = new StreetLightsPlugin();
    await plugin.init(view, NO_CTX);

    const overtaken = plugin.start({
      ...START,
      roads: { ...TEST_ROADS, sourceType: "tilejson", sourceUrl: "https://a" },
    });
    await flush();
    plugin.dispose();
    open();
    await overtaken;

    expect(
      (await addSource.mock.results[0].value).delete,
    ).toHaveBeenCalledTimes(1);
    expect(view.addLayer).not.toHaveBeenCalled();
  });

  it("disposes the TileJSON resolver it created", async () => {
    const disposeTileJson = vi.spyOn(TileJsonPlugin.prototype, "dispose");
    const { view } = makeFakeView();
    const plugin = new StreetLightsPlugin();
    await plugin.init(view, NO_CTX);
    plugin.dispose();
    expect(disposeTileJson).toHaveBeenCalledTimes(1);
  });
});

describe("StreetLightsPlugin streaming", () => {
  it("adds the lights and traffic of the tile under the followed position", async () => {
    const { view, lamps, beacons, meshes } = await started();

    // The road source, then one source each for the lamps and the beacons.
    expect(view.addSource).toHaveBeenCalledTimes(3);
    expect(view.addSource).toHaveBeenCalledWith({
      type: "geojson",
      data: expect.objectContaining({ type: "FeatureCollection" }),
    });
    expect(view.addLayer).toHaveBeenCalledTimes(3);
    const [, lampsDesc, beaconsDesc] = vi
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

  it("adds nothing for a tile without roads or roofs", async () => {
    const { view } = makeFakeView();
    const plugin = new StreetLightsPlugin();
    await plugin.init(view, NO_CTX);
    vi.mocked(loadRoadNetwork).mockResolvedValue({ roads: [], roofs: [] });
    await plugin.start(START);
    plugin.follow(TOKYO.lng, TOKYO.lat);
    await flush();

    // The road surface's source and layer only.
    expect(view.addSource).toHaveBeenCalledTimes(1);
    expect(view.addLayer).toHaveBeenCalledTimes(1);
    expect(view.addMesh).not.toHaveBeenCalled();
    plugin.setLightsOn(false);
    plugin.update({ traffic: { speed: 2 } });
    plugin.dispose();
  });

  it("drops a tile once the followed position leaves it", async () => {
    const { plugin, view, lamps, beacons, sources, meshes } = await started();

    const east = tileEast(2);
    plugin.follow(east.lng, east.lat);
    await flush();

    expect(lamps.delete).toHaveBeenCalledTimes(1);
    expect(beacons.delete).toHaveBeenCalledTimes(1);
    expect(sources[1].delete).toHaveBeenCalledTimes(1);
    expect(sources[2].delete).toHaveBeenCalledTimes(1);
    expect(sources[0].delete).not.toHaveBeenCalled();
    expect(meshes[0].delete).toHaveBeenCalledTimes(1);
    expect(view.addSource).toHaveBeenCalledTimes(5);
  });

  it("turns the lights off and on through the evaluators and the traffic visibility", async () => {
    const { plugin, view, lamps, beacons, meshes } = await started();

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
    const { plugin, view, surface, lamps, beacons, meshes } = await started();

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

  it("start() again drops everything the previous start added", async () => {
    const { plugin, surface, lamps, sources } = await started();
    await plugin.start(START);
    expect(surface.delete).toHaveBeenCalledTimes(1);
    expect(sources[0].delete).toHaveBeenCalledTimes(1);
    expect(lamps.delete).toHaveBeenCalledTimes(1);
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
    const { plugin, view, surface, lamps, beacons, sources, meshes } =
      await started();

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
    expect(surface.delete).toHaveBeenCalledTimes(1);
    expect(lamps.delete).toHaveBeenCalledTimes(1);
    expect(beacons.delete).toHaveBeenCalledTimes(1);
    for (const source of sources) {
      expect(source.delete).toHaveBeenCalledTimes(1);
    }
    expect(meshes[0].delete).toHaveBeenCalledTimes(1);

    const added = vi.mocked(view.addSource).mock.calls.length;
    settle(NETWORK);
    await flush();
    expect(view.addSource).toHaveBeenCalledTimes(added);
    await expect(plugin.start(START)).rejects.toThrow(/view\.init\(\)/);
  });
});
