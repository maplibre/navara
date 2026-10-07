import { headingPitchRollToFixedFrame } from "@navaramap/three-api";
import {
  BoxGeometry,
  MeshBasicMaterial,
  Matrix4,
  Mesh,
  Scene,
  Vector3,
} from "three";
import invariant from "tiny-invariant";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type ThreeView from "../index";
import { initTestEngine } from "../test-utils/engine";

import { ConflictingTransformError } from "./errors";
import { MeshDesc, type MeshConfig, type MeshUpdate } from "./MeshDesc";
import type { ViewContext } from "./ViewContext";

// vitest never initialises the WASM module, so the real
// `headingPitchRollToFixedFrame` throws
// "Cannot read properties of undefined (reading 'lle_new')". Stand in a
// transparent model that encodes its inputs into the translation column, so
// every assertion below can name exactly which placement was lowered.
//
// These tests are about LOWERING — does `geodetic` reach `matrixWorld`, does a
// partial update merge, does terrain height get added, do conflicts throw.
// The geodesy itself is covered without any mocks by `frames.test.ts` and
// `index.test.ts` in @navaramap/three-api, so re-deriving it here would only
// duplicate the production formula and prove nothing.
vi.mock("@navaramap/three-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@navaramap/three-api")>();
  const { Matrix4: M } = await import("three");
  return {
    ...actual,
    headingPitchRollToFixedFrame: vi.fn(
      (p: { lng: number; lat: number; height?: number }) =>
        new M().makeTranslation(p.lng, p.lat, p.height ?? 0),
    ),
  };
});

class TestMeshDesc extends MeshDesc<MeshConfig, MeshUpdate, Mesh> {
  createMesh() {
    return new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  }
}

const makeCtx = () =>
  ({
    scenes: {
      opaque: new Scene(),
      transparent: new Scene(),
      mrt: new Scene(),
      skyEnvMap: new Scene(),
      draped: new Scene(),
    },
    emit: vi.fn(),
    applyShadowMaterial: vi.fn(),
    registerPickableMesh: vi.fn(),
  }) as unknown as ViewContext;

const makeView = () =>
  ({
    sampleTerrainHeight: vi.fn(() => undefined),
    observeTerrainHeightAt: vi.fn(() => () => {}),
  }) as unknown as ThreeView;

const create = (config: MeshConfig) => {
  const desc = new TestMeshDesc(makeView(), makeCtx(), config);
  desc.onCreate();
  return desc;
};

/** The placement object most recently handed to the frame builder. */
const lastPlacement = () => {
  const calls = vi.mocked(headingPitchRollToFixedFrame).mock.calls;
  return calls[calls.length - 1]?.[0];
};

/**
 * The `Object3D` a Descriptor created, with `undefined` narrowed away.
 * A helper rather than `desc.raw!` — the repo bans non-null assertions
 * (`@typescript-eslint/no-non-null-assertion`), and this yields a named
 * failure instead of a `TypeError` if `onCreate` ever stops setting it.
 */
const rawOf = (desc: TestMeshDesc) => {
  const { raw } = desc;
  invariant(raw, "descriptor has no Three.js instance");
  return raw;
};

const translationOf = (m: Matrix4) =>
  new Vector3().setFromMatrixPosition(m).toArray();

const TOKYO = { lng: 139.767125, lat: 35.681236 };

// Two DIFFERENT WASM modules are in play, and they need opposite treatment.
// `@navaramap/engine-api` (the geodetic math) stays mocked, above.
// `@navaramap/engine` is a separate module backing `generateId()`, which
// `BaseDesc`'s constructor calls for any Descriptor created without an
// explicit `id` — so it must be really initialised. `initTestEngine` is the
// project's helper for exactly this and is idempotent per vitest worker.
// Do not replace this by passing an `id` to every config: that hides the
// dependency, and the next Rust-backed call added to BaseDesc/MeshDesc would
// break this suite for a reason nobody would connect back to the workaround.
beforeAll(initTestEngine);

beforeEach(() => {
  vi.mocked(headingPitchRollToFixedFrame).mockClear();
});

describe("MeshDesc geodetic placement", () => {
  it("places the mesh via matrixWorld and disables auto updates", () => {
    const desc = create({ geodetic: { ...TOKYO, height: 100 } });
    const raw = rawOf(desc);

    expect(raw.matrixAutoUpdate).toBe(false);
    expect(raw.matrixWorldAutoUpdate).toBe(false);
    expect(translationOf(raw.matrixWorld)).toEqual([TOKYO.lng, TOKYO.lat, 100]);
  });

  it("forwards the whole placement to the frame builder, without heightReference", () => {
    create({
      geodetic: {
        ...TOKYO,
        height: 5,
        heading: 321,
        pitch: 4,
        roll: -2,
        scale: 3,
        heightReference: "ellipsoid",
      },
    });

    expect(lastPlacement()).toEqual({
      lng: TOKYO.lng,
      lat: TOKYO.lat,
      height: 5,
      heading: 321,
      pitch: 4,
      roll: -2,
      scale: 3,
    });
    // `headingPitchRollToFixedFrame` takes Omit<…, "heightReference">;
    // leaking it would mean silently ignoring a terrain request.
    expect(lastPlacement()).not.toHaveProperty("heightReference");
  });

  it("composes position and scale as offsets inside the frame", () => {
    const desc = create({
      geodetic: TOKYO,
      position: { x: 0, y: 500, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    });

    // Pins the documented order `frame · T · R · S`, scale innermost.
    const expected = new Matrix4()
      .makeTranslation(TOKYO.lng, TOKYO.lat, 0)
      .multiply(new Matrix4().makeTranslation(0, 500, 0))
      .multiply(new Matrix4().makeScale(2, 2, 2));

    rawOf(desc).matrixWorld.elements.forEach((value, i) => {
      expect(value).toBeCloseTo(expected.elements[i], 9);
    });
  });

  it("throws when geodetic is combined with matrixWorld or matrix", () => {
    expect(() =>
      create({ geodetic: TOKYO, matrixWorld: new Matrix4() }),
    ).toThrow(ConflictingTransformError);
    expect(() => create({ geodetic: TOKYO, matrix: new Matrix4() })).toThrow(
      ConflictingTransformError,
    );
  });

  // `matrix` was previously accepted alongside `matrixWorld` and then dropped
  // by `applyTransform`'s priority chain — and it cannot be honoured there at
  // all, since the `matrixWorld` branch turns `matrixWorldAutoUpdate` off, so
  // Three.js never derives `matrixWorld` from `matrix` again.
  it("throws when matrix is combined with matrixWorld", () => {
    expect(() =>
      create({ matrix: new Matrix4(), matrixWorld: new Matrix4() }),
    ).toThrow(ConflictingTransformError);
  });

  it("throws when an update introduces matrix onto a matrixWorld mesh", () => {
    const frame = new Matrix4().makeTranslation(1, 2, 3);
    const desc = create({ matrixWorld: frame });

    expect(() => desc.onUpdateConfig({ matrix: new Matrix4() })).toThrow(
      ConflictingTransformError,
    );

    // The rejected field must not have landed, and the surviving placement
    // must still be the one that was configured.
    expect(desc.matrix).toBeUndefined();
    expect(translationOf(rawOf(desc).matrixWorld)).toEqual([1, 2, 3]);
    expect(() => desc.onUpdateConfig({ visible: false })).not.toThrow();
  });

  it("throws when an update introduces matrixWorld onto a matrix mesh", () => {
    const desc = create({ matrix: new Matrix4().makeTranslation(4, 5, 6) });

    expect(() => desc.onUpdateConfig({ matrixWorld: new Matrix4() })).toThrow(
      ConflictingTransformError,
    );

    expect(desc.matrixWorld).toBeUndefined();
    expect(translationOf(rawOf(desc).matrix)).toEqual([4, 5, 6]);
  });

  it("merges a partial geodetic update instead of replacing it", () => {
    const desc = create({ geodetic: { ...TOKYO, height: 100, heading: 10 } });

    desc.onUpdateConfig({ geodetic: { heading: 200 } });

    // lng/lat/height survived a heading-only update.
    expect(lastPlacement()).toEqual({
      lng: TOKYO.lng,
      lat: TOKYO.lat,
      height: 100,
      heading: 200,
    });
    expect(desc.geodetic).toEqual({ ...TOKYO, height: 100, heading: 200 });
  });

  it("rejects a partial geodetic update on a mesh with no placement", () => {
    const desc = create({ position: { x: 1, y: 2, z: 3 } });
    expect(() => desc.onUpdateConfig({ geodetic: { heading: 90 } })).toThrow(
      /requires `lng` and `lat`/,
    );
  });

  it("throws when an update introduces a conflicting matrixWorld", () => {
    const desc = create({ geodetic: TOKYO });
    expect(() => desc.onUpdateConfig({ matrixWorld: new Matrix4() })).toThrow(
      ConflictingTransformError,
    );
  });

  it("throws when an update introduces a conflicting matrix", () => {
    const desc = create({ geodetic: TOKYO });
    expect(() => desc.onUpdateConfig({ matrix: new Matrix4() })).toThrow(
      ConflictingTransformError,
    );
  });

  it("leaves the mesh usable after a rejected update", () => {
    const desc = create({ geodetic: { ...TOKYO, heading: 10 } });

    expect(() => desc.onUpdateConfig({ matrixWorld: new Matrix4() })).toThrow(
      ConflictingTransformError,
    );

    // The rejected field must not have landed, or the guard would fire on
    // every later call and no update could ever clear it again.
    expect(desc.matrixWorld).toBeUndefined();
    expect(() => desc.onUpdateConfig({ visible: false })).not.toThrow();
    expect(() =>
      desc.onUpdateConfig({ geodetic: { heading: 20 } }),
    ).not.toThrow();
    expect(desc.geodetic?.heading).toBe(20);
  });

  it("leaves the existing matrixWorld path untouched", () => {
    const desc = create({
      matrixWorld: new Matrix4().makeTranslation(1, 2, 3),
    });

    expect(translationOf(rawOf(desc).matrixWorld)).toEqual([1, 2, 3]);
    expect(headingPitchRollToFixedFrame).not.toHaveBeenCalled();
  });
});

describe("MeshDesc terrain-referenced placement", () => {
  type LatLngDeg = { lat: number; lng: number };

  const terrainView = (height: number | undefined) => {
    const listeners: ((h: number) => void)[] = [];
    const unsubscribe = vi.fn();
    const spy = {
      sampleTerrainHeight: vi.fn((_pos: LatLngDeg) => height),
      observeTerrainHeightAt: vi.fn(
        (_pos: LatLngDeg, cb: (h: number) => void) => {
          listeners.push(cb);
          return unsubscribe;
        },
      ),
    };
    return { view: spy as unknown as ThreeView, listeners, unsubscribe, spy };
  };

  const createWith = (view: ThreeView, config: MeshConfig) => {
    const desc = new TestMeshDesc(view, makeCtx(), config);
    desc.onCreate();
    return desc;
  };

  it("seeds from the resident-tile sample and subscribes", () => {
    const { view, spy } = terrainView(300);
    createWith(view, {
      geodetic: { ...TOKYO, height: 10, heightReference: "terrain" },
    });

    expect(spy.sampleTerrainHeight).toHaveBeenCalled();
    expect(spy.observeTerrainHeightAt).toHaveBeenCalled();

    // Both terrain methods take the same degrees `geodetic` carries.
    const pos = spy.sampleTerrainHeight.mock.calls[0][0];
    expect(pos.lat).toBeCloseTo(TOKYO.lat, 9);
    expect(pos.lng).toBeCloseTo(TOKYO.lng, 9);

    // terrain 300 + requested 10
    expect(lastPlacement()?.height).toBeCloseTo(310, 9);
    expect(lastPlacement()).not.toHaveProperty("heightReference");
  });

  it("re-places the mesh when terrain refines", () => {
    const { view, listeners } = terrainView(0);
    createWith(view, {
      geodetic: { ...TOKYO, height: 10, heightReference: "terrain" },
    });
    expect(lastPlacement()?.height).toBeCloseTo(10, 9);

    listeners[0](450);

    expect(lastPlacement()?.height).toBeCloseTo(460, 9);
  });

  it("falls back to ellipsoid height when no terrain is loaded", () => {
    const { view, spy } = terrainView(undefined);
    createWith(view, {
      geodetic: { ...TOKYO, height: 10, heightReference: "terrain" },
    });

    // Still subscribes — a terrain layer may be added after the mesh.
    expect(spy.observeTerrainHeightAt).toHaveBeenCalled();
    expect(lastPlacement()?.height).toBeCloseTo(10, 9);
  });

  it("does not subscribe for ellipsoid-referenced placements", () => {
    const { view, spy } = terrainView(300);
    createWith(view, { geodetic: { ...TOKYO, heightReference: "ellipsoid" } });
    expect(spy.observeTerrainHeightAt).not.toHaveBeenCalled();
    expect(spy.sampleTerrainHeight).not.toHaveBeenCalled();

    const { view: v2, spy: s2 } = terrainView(300);
    createWith(v2, { geodetic: TOKYO });
    expect(s2.observeTerrainHeightAt).not.toHaveBeenCalled();
  });

  it("unsubscribes on destroy", () => {
    const { view, unsubscribe } = terrainView(300);
    const desc = createWith(view, {
      geodetic: { ...TOKYO, heightReference: "terrain" },
    });

    desc.onDestroy();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("re-subscribes when the position or height reference changes", () => {
    const { view, unsubscribe, spy } = terrainView(300);
    const desc = createWith(view, {
      geodetic: { ...TOKYO, heightReference: "terrain" },
    });
    expect(spy.observeTerrainHeightAt).toHaveBeenCalledTimes(1);

    desc.onUpdateConfig({ geodetic: { lng: 140 } });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(spy.observeTerrainHeightAt).toHaveBeenCalledTimes(2);

    desc.onUpdateConfig({ geodetic: { heightReference: "ellipsoid" } });
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(spy.observeTerrainHeightAt).toHaveBeenCalledTimes(2);
    // Dropping the terrain reference drops the terrain contribution too.
    expect(lastPlacement()?.height).toBeCloseTo(0, 9);
  });

  it("does not re-subscribe for a heading-only update", () => {
    const { view, unsubscribe, spy } = terrainView(300);
    const desc = createWith(view, {
      geodetic: { ...TOKYO, heightReference: "terrain" },
    });

    desc.onUpdateConfig({ geodetic: { heading: 90 } });

    expect(unsubscribe).not.toHaveBeenCalled();
    expect(spy.observeTerrainHeightAt).toHaveBeenCalledTimes(1);
    // The re-composed placement still carries the seeded terrain height.
    expect(lastPlacement()?.height).toBeCloseTo(300, 9);
    expect(lastPlacement()?.heading).toBe(90);
  });
});

describe("MeshDesc draped G-buffer requirement", () => {
  type DrapedConfig = MeshConfig & { draped?: boolean };

  class SwitchableDrapeDesc extends MeshDesc<DrapedConfig, MeshUpdate, Mesh> {
    draped: boolean;

    constructor(view: ThreeView, ctx: ViewContext, config: DrapedConfig) {
      super(view, ctx, config);
      this.draped = config.draped ?? false;
    }

    createMesh() {
      return new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    }

    protected override getPassKey() {
      return this.draped ? "draped" : super.getPassKey();
    }
  }

  const createSwitchable = (draped: boolean) => {
    const ctx = makeCtx();
    const desc = new SwitchableDrapeDesc(makeView(), ctx, { draped });
    desc.onCreate();
    return { desc, emit: vi.mocked(ctx.emit) };
  };

  it("requires the globe normal only in the draped pass", () => {
    expect(createSwitchable(true).desc.getRequiredBuffers()).toEqual([
      "globeNormal",
    ]);
    expect(createSwitchable(false).desc.getRequiredBuffers()).toEqual([]);
  });

  it("re-derives the G-buffers when the mesh enters or leaves the draped pass", () => {
    const { desc, emit } = createSwitchable(false);
    emit.mockClear();

    desc.draped = true;
    desc.onPassKeyChange();
    expect(emit).toHaveBeenCalledWith("gbufferRequirementsChanged");

    emit.mockClear();
    desc.draped = false;
    desc.onPassKeyChange();
    expect(emit).toHaveBeenCalledWith("gbufferRequirementsChanged");
  });
});
