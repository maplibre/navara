import { DataTexture, HalfFloatType, RGBAFormat, type Texture } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Atmosphere, type AtmosphereOptions } from "./atmosphere";
import { initTestEngine } from "./test-utils/engine";

initTestEngine();

const { loadAsyncMock } = vi.hoisted(() => ({
  loadAsyncMock: vi.fn(),
}));

vi.mock("@takram/three-atmosphere", () => ({
  getSunDirectionECEF: vi.fn(),
  getMoonDirectionECEF: vi.fn(),
  getECIToECEFRotationMatrix: vi.fn(),
  TRANSMITTANCE_TEXTURE_WIDTH: 256,
  TRANSMITTANCE_TEXTURE_HEIGHT: 64,
  IRRADIANCE_TEXTURE_WIDTH: 64,
  IRRADIANCE_TEXTURE_HEIGHT: 16,
  SCATTERING_TEXTURE_WIDTH: 256,
  SCATTERING_TEXTURE_HEIGHT: 128,
  SCATTERING_TEXTURE_DEPTH: 32,
}));

vi.mock("@takram/three-geospatial", async (importOriginal) => {
  const { Ellipsoid } =
    await importOriginal<typeof import("@takram/three-geospatial")>();
  class MockLoader {
    loadAsync = loadAsyncMock;
  }
  return {
    Ellipsoid,
    EXRTextureLoader: MockLoader,
    EXR3DTextureLoader: MockLoader,
  };
});

/** What the EXR loaders resolve with: half floats in a `Uint16Array`. */
const fakeTexture = () =>
  new DataTexture(new Uint16Array(4), 1, 1, RGBAFormat, HalfFloatType);

/** Resolves every load immediately with a fake texture, recording the URL. */
const autoResolveLoads = () => {
  loadAsyncMock.mockImplementation(() => Promise.resolve(fakeTexture()));
};

const requestedFiles = () =>
  loadAsyncMock.mock.calls.map((call) => {
    const url = call[0] as string;
    return url.slice(url.lastIndexOf("/") + 1).replace(/\?.*$/, "");
  });

const createAtmosphere = (options?: Partial<AtmosphereOptions>) =>
  new Atmosphere({ date: new Date(0), ...options });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Atmosphere.initTextures", () => {
  beforeEach(() => {
    loadAsyncMock.mockReset();
  });

  it("loads all four textures", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere();

    await atmosphere.initTextures();

    expect(requestedFiles().sort()).toEqual([
      "higher_order_scattering.exr",
      "irradiance.exr",
      "scattering.exr",
      "transmittance.exr",
    ]);
    expect(atmosphere.textures.transmittanceTexture).toBeDefined();
    expect(atmosphere.textures.scatteringTexture).toBeDefined();
    expect(atmosphere.textures.irradianceTexture).toBeDefined();
    expect(atmosphere.textures.higherOrderScatteringTexture).toBeDefined();
  });

  it("shares in-flight loads across concurrent calls", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere();

    await Promise.all([atmosphere.initTextures(), atmosphere.initTextures()]);

    expect(loadAsyncMock).toHaveBeenCalledTimes(4);
  });

  it("does not reload once textures are loaded", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere();

    await atmosphere.initTextures();
    await atmosphere.initTextures();

    expect(loadAsyncMock).toHaveBeenCalledTimes(4);
  });

  it("emits textureLoaded once per texture", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere();
    const onLoaded = vi.fn();
    atmosphere.on("textureLoaded", onLoaded);

    await atmosphere.initTextures();

    expect(onLoaded).toHaveBeenCalledTimes(4);
  });

  it("retries only the texture that failed", async () => {
    let failTransmittance = true;
    loadAsyncMock.mockImplementation((url: string) => {
      if (failTransmittance && url.includes("transmittance.exr")) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve(fakeTexture());
    });
    const atmosphere = createAtmosphere();

    await expect(atmosphere.initTextures()).rejects.toThrow("network error");
    expect(atmosphere.textures.transmittanceTexture).toBeUndefined();
    expect(atmosphere.textures.scatteringTexture).toBeDefined();

    failTransmittance = false;
    await atmosphere.initTextures();

    expect(atmosphere.textures.transmittanceTexture).toBeDefined();
    expect(
      requestedFiles().filter((f) => f === "transmittance.exr"),
    ).toHaveLength(2);
    expect(requestedFiles().filter((f) => f === "scattering.exr")).toHaveLength(
      1,
    );
  });

  it("drops a texture that arrives after dispose", async () => {
    const pending: ((texture: Texture) => void)[] = [];
    loadAsyncMock.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const atmosphere = createAtmosphere();
    const onLoaded = vi.fn();
    atmosphere.on("textureLoaded", onLoaded);
    const loading = atmosphere.initTextures();

    atmosphere._dispose();
    const textures = pending.map((resolve) => {
      const texture = fakeTexture();
      const dispose = vi.spyOn(texture, "dispose");
      resolve(texture);
      return dispose;
    });
    await loading;

    expect(atmosphere.textures).toEqual({});
    expect(onLoaded).not.toHaveBeenCalled();
    for (const dispose of textures) {
      expect(dispose).toHaveBeenCalled();
    }
  });

  it("loads from atmosphereAssetsUrl when provided, normalizing slashes", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere({
      atmosphereAssetsUrl: "https://example.com/assets/",
    });

    await atmosphere.initTextures();

    for (const [url] of loadAsyncMock.mock.calls as [string][]) {
      expect(url).toMatch(/^https:\/\/example\.com\/assets\/[a-z_]+\.exr$/);
    }
  });
});

describe("Atmosphere texture data", () => {
  beforeEach(() => {
    loadAsyncMock.mockReset();
  });

  const dataOf = (texture: Texture | undefined) =>
    (texture?.image as { data: unknown } | undefined)?.data;

  const uploadAll = (atmosphere: Atmosphere) => {
    for (const texture of Object.values(atmosphere.textures)) {
      texture.onUpdate?.(texture);
    }
  };

  it("keeps the loaded half-float data", async () => {
    const loadedData: unknown[] = [];
    loadAsyncMock.mockImplementation(() => {
      const texture = fakeTexture();
      loadedData.push(texture.image.data);
      return Promise.resolve(texture);
    });
    const atmosphere = createAtmosphere();

    await atmosphere.initTextures();

    const textures = Object.values(atmosphere.textures);
    expect(textures.map((t) => t.type)).toEqual(Array(4).fill(HalfFloatType));
    for (const texture of textures) {
      expect(loadedData).toContain(dataOf(texture));
    }
  });

  it("drops the CPU copy of the 3D textures once uploaded", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere();
    await atmosphere.initTextures();

    uploadAll(atmosphere);

    const { textures } = atmosphere;
    expect(dataOf(textures.scatteringTexture)).toBeNull();
    expect(dataOf(textures.higherOrderScatteringTexture)).toBeNull();
    expect(dataOf(textures.transmittanceTexture)).toBeInstanceOf(Uint16Array);
    expect(dataOf(textures.irradianceTexture)).toBeInstanceOf(Uint16Array);
  });
});

describe("Atmosphere.onTexturesReady", () => {
  beforeEach(() => {
    loadAsyncMock.mockReset();
  });

  it("does not load anything until a consumer registers", () => {
    autoResolveLoads();
    createAtmosphere();

    expect(loadAsyncMock).not.toHaveBeenCalled();
  });

  it("loads only the needed textures", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere();
    const callback = vi.fn();

    atmosphere.onTexturesReady(callback, { transmittance: true });
    await flush();

    expect(requestedFiles()).toEqual(["transmittance.exr"]);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].transmittanceTexture).toBeDefined();
  });

  it("shares a fetch between consumers needing the same texture", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere();
    const first = vi.fn();
    const second = vi.fn();

    atmosphere.onTexturesReady(first, { transmittance: true });
    atmosphere.onTexturesReady(second, { transmittance: true });
    await flush();

    expect(loadAsyncMock).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("fetches only the missing textures for wider needs", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere();

    atmosphere.onTexturesReady(vi.fn(), { transmittance: true });
    await flush();
    const callback = vi.fn();
    atmosphere.onTexturesReady(callback, {
      transmittance: true,
      scattering: true,
    });
    await flush();

    expect(requestedFiles()).toEqual(["transmittance.exr", "scattering.exr"]);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("loads all textures and fires once when needs are omitted", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere();
    const callback = vi.fn();

    atmosphere.onTexturesReady(callback);
    await flush();

    expect(loadAsyncMock).toHaveBeenCalledTimes(4);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("waits until every needed texture is ready", async () => {
    const pending = new Map<string, (t: unknown) => void>();
    loadAsyncMock.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          pending.set(
            url.slice(url.lastIndexOf("/") + 1).replace(/\?.*$/, ""),
            resolve,
          );
        }),
    );
    const atmosphere = createAtmosphere();
    const callback = vi.fn();

    atmosphere.onTexturesReady(callback, {
      transmittance: true,
      scattering: true,
    });
    pending.get("transmittance.exr")?.(fakeTexture());
    await flush();
    expect(callback).not.toHaveBeenCalled();

    pending.get("scattering.exr")?.(fakeTexture());
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("invokes the callback immediately once loaded", async () => {
    autoResolveLoads();
    const atmosphere = createAtmosphere();
    await atmosphere.initTextures();
    const callback = vi.fn();

    atmosphere.onTexturesReady(callback, { irradiance: true });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(loadAsyncMock).toHaveBeenCalledTimes(4);
  });

  it("logs instead of rejecting when a lazy load fails", async () => {
    const error = new Error("network error");
    loadAsyncMock.mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const atmosphere = createAtmosphere();

    atmosphere.onTexturesReady(vi.fn(), { transmittance: true });

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "Failed to load atmosphere textures:",
        error,
      );
    });
    consoleError.mockRestore();
  });
});

describe("Atmosphere.ellipsoid", () => {
  const WGS84_A = 6378137;
  const WGS84_B = 6356752.314245179;

  it("is WGS84 without a terrain exaggeration", () => {
    const atmosphere = createAtmosphere();
    atmosphere._update([1, 0]);

    expect(atmosphere.ellipsoid.radii.x).toBe(WGS84_A);
    expect(atmosphere.ellipsoid.radii.z).toBeCloseTo(WGS84_B, 6);
  });

  it("moves to the sea level the exaggeration renders", () => {
    const atmosphere = createAtmosphere();
    const ellipsoid = atmosphere.ellipsoid;

    // Scale 5 around 2000 m moves sea level to -8000 m.
    atmosphere._update([5, 2000]);
    expect(ellipsoid.radii.x).toBe(WGS84_A - 8000);
    expect(ellipsoid.radii.y).toBe(WGS84_A - 8000);
    expect(ellipsoid.radii.z).toBeCloseTo(WGS84_B - 8000, 6);

    atmosphere._update([1, 0]);
    expect(ellipsoid.radii.x).toBe(WGS84_A);
    // The instance is kept, so consumers holding it follow the change.
    expect(atmosphere.ellipsoid).toBe(ellipsoid);
  });
});
