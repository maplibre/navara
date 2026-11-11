import { DataTextureLoader, STBNLoader } from "@takram/three-geospatial";
import {
  Data3DTexture,
  PerspectiveCamera,
  Texture,
  TextureLoader,
  Vector2,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Clouds, type CloudsOptions } from "./pass";

// The package index boots the worker pool, which needs a browser.
vi.mock("@navaramap/three", async () => ({
  ...(await vi.importActual("../../../../navara_three/src/effects/effect")),
  ...(await vi.importActual(
    "../../../../navara_three/src/effects/CustomEffectPass",
  )),
  CLOUD_LOCAL_WEATHER_URL: "local_weather.png",
  CLOUD_SHAPE_URL: "shape.bin",
  CLOUD_SHAPE_DETAIL_URL: "shape_detail.bin",
  CLOUD_TURBULENCE_URL: "turbulence.png",
  STBN_URL: "stbn.bin",
}));

const fakeAtmosphere = () => {
  const listeners = new Map<string, Set<() => void>>();
  const cancelTexturesReady = vi.fn();
  return {
    ellipsoid: undefined,
    sunDirection: { x: 0, y: 0, z: 1 },
    enableShadows: { value: false },
    overlay: { value: null },
    shadow: { value: null },
    shadowLength: { value: null },
    onTexturesReady: vi.fn(() => cancelTexturesReady),
    cancelTexturesReady,
    onUpdate: vi.fn(),
    on: (t: string, f: () => void) => {
      const set = listeners.get(t) ?? new Set();
      set.add(f);
      listeners.set(t, set);
    },
    off: (t: string, f: () => void) => listeners.get(t)?.delete(f),
    listenerCount: (t: string) => listeners.get(t)?.size ?? 0,
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const createClouds = (options: CloudsOptions) => {
  vi.spyOn(Clouds.prototype, "loadAll").mockReturnValue(
    new Promise<never>(() => {}),
  );
  return new Clouds(
    new PerspectiveCamera(),
    fakeAtmosphere() as never,
    options,
  );
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Clouds.dispose", () => {
  it("disposes the textures it loaded", async () => {
    const loaded: Texture[] = [];
    const tex = <T extends Texture>(t: T) => {
      loaded.push(t);
      return t;
    };
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockImplementation(
      async () => tex(new Texture()),
    );
    vi.spyOn(DataTextureLoader.prototype, "loadAsync").mockImplementation(
      async () => tex(new Data3DTexture()) as never,
    );
    vi.spyOn(STBNLoader.prototype, "loadAsync").mockImplementation(
      async () => tex(new Data3DTexture()) as never,
    );
    const atmosphere = fakeAtmosphere();
    const clouds = new Clouds(new PerspectiveCamera(), atmosphere as never, {
      qualityPreset: "low",
    });
    await flush();
    const spies = loaded.map((t) => vi.spyOn(t, "dispose"));

    clouds.dispose();

    expect(loaded.length).toBeGreaterThan(0);
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });

  it("stops listening to the atmosphere", () => {
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockImplementation(
      () => new Promise(() => {}),
    );
    vi.spyOn(DataTextureLoader.prototype, "loadAsync").mockImplementation(
      () => new Promise(() => {}),
    );
    vi.spyOn(STBNLoader.prototype, "loadAsync").mockImplementation(
      () => new Promise(() => {}),
    );
    const atmosphere = fakeAtmosphere();
    const clouds = new Clouds(new PerspectiveCamera(), atmosphere as never, {
      qualityPreset: "low",
    });

    const onUpdate = vi.mocked(atmosphere.onUpdate);
    onUpdate.mockClear();

    clouds.dispose();
    clouds.inner.events.dispatchEvent({
      type: "change",
      property: "atmosphereOverlay",
    });

    expect(atmosphere.listenerCount("disposed")).toBe(0);
    expect(atmosphere.cancelTexturesReady).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("frees a texture that finishes loading after dispose", async () => {
    let resolve: (t: never) => void = () => {};
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    vi.spyOn(DataTextureLoader.prototype, "loadAsync").mockImplementation(
      () => new Promise(() => {}),
    );
    vi.spyOn(STBNLoader.prototype, "loadAsync").mockImplementation(
      () => new Promise(() => {}),
    );
    const clouds = new Clouds(
      new PerspectiveCamera(),
      fakeAtmosphere() as never,
      { qualityPreset: "low" },
    );
    clouds.dispose();
    const late = new Texture();
    const dispose = vi.spyOn(late, "dispose");

    resolve(late as never);
    await flush();

    expect(dispose).toHaveBeenCalled();
  });

  it("frees the STBN replaced by the shadow reload", async () => {
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockImplementation(
      () => new Promise(() => {}),
    );
    vi.spyOn(DataTextureLoader.prototype, "loadAsync").mockImplementation(
      () => new Promise(() => {}),
    );
    const first = new Data3DTexture();
    const second = new Data3DTexture();
    vi.spyOn(STBNLoader.prototype, "loadAsync").mockResolvedValue(
      first as never,
    );
    vi.spyOn(STBNLoader.prototype, "load").mockImplementation(
      (_url, onLoad) => {
        onLoad?.(second as never);
        return second as never;
      },
    );
    const clouds = new Clouds(
      new PerspectiveCamera(),
      fakeAtmosphere() as never,
      { qualityPreset: "low" },
    );
    await flush();
    const disposeFirst = vi.spyOn(first, "dispose");
    const disposeSecond = vi.spyOn(second, "dispose");

    clouds.inner.events.dispatchEvent({
      type: "change",
      property: "atmosphereShadow",
    });

    expect(clouds.inner.stbnTexture).toBe(second);
    expect(disposeFirst).toHaveBeenCalled();
    expect(disposeSecond).not.toHaveBeenCalled();

    clouds.dispose();

    expect(disposeSecond).toHaveBeenCalled();
  });
});

describe("Clouds shadow map", () => {
  it.each([
    ["low", 256, 2],
    ["medium", 256, 3],
    ["high", 512, 3],
    ["ultra", 1024, 3],
  ] as const)(
    "takes the %s preset's map size and cascade count",
    (qualityPreset, mapSize, cascadeCount) => {
      const clouds = createClouds({ qualityPreset });
      expect(clouds.shadowMapSize.toArray()).toEqual([mapSize, mapSize]);
      expect(clouds.shadowCascadeCount).toBe(cascadeCount);
    },
  );

  it("prefers explicit options over the preset", () => {
    const clouds = createClouds({
      qualityPreset: "low",
      shadowMapSize: new Vector2(1024, 1024),
      shadowCascadeCount: 4,
    });
    expect(clouds.shadowMapSize.toArray()).toEqual([1024, 1024]);
    expect(clouds.shadowCascadeCount).toBe(4);
  });

  it("keeps in-place size changes out of the preset", () => {
    const clouds = createClouds({ qualityPreset: "medium" });
    clouds.shadowMapSize.set(1024, 1024);
    clouds.qualityPreset = "high";
    clouds.qualityPreset = "medium";
    expect(clouds.shadowMapSize.toArray()).toEqual([256, 256]);
    expect(
      createClouds({ qualityPreset: "medium" }).shadowMapSize.toArray(),
    ).toEqual([256, 256]);
  });
});
