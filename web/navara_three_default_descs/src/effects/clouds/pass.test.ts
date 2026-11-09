import { DataTextureLoader, STBNLoader } from "@takram/three-geospatial";
import {
  Data3DTexture,
  PerspectiveCamera,
  Texture,
  TextureLoader,
} from "three";
import { describe, expect, it, vi } from "vitest";

import { Clouds } from "./pass";

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
  return {
    ellipsoid: undefined,
    sunDirection: { x: 0, y: 0, z: 1 },
    enableShadows: { value: false },
    overlay: { value: null },
    shadow: { value: null },
    shadowLength: { value: null },
    onTexturesReady: vi.fn(),
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

    clouds.dispose();

    expect(atmosphere.listenerCount("disposed")).toBe(0);
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
