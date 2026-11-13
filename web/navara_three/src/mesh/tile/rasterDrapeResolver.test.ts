import { LinearFilter, type Texture } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  BakedRasterDrapeResolver,
  type RasterDrapeHost,
} from "./rasterDrapeResolver";

/** One Rust-resolved raster source of the baked layer `ordinal`. */
function state(ordinal: number) {
  return {
    layer_ordinal: ordinal,
    fragment_ind: 1,
    fragment_gen: 0,
    uv_offset: new Float32Array([0, 0]),
    uv_scale: new Float32Array([1, 1]),
    reproject_terrain_lat: new Float32Array([]),
    free: vi.fn(),
  };
}

/** A resolver whose material has one baked (fragment-less) raster slot. */
function makeResolver() {
  const textures: (Texture | null)[] = [null];
  const material = { userData: { textures: { value: textures } } };
  const getRasterTileStates = vi.fn(() => [state(0)]);
  const renderRasterTiles = vi.fn();
  const resolver = new BakedRasterDrapeResolver({
    handle: 1n,
    tileHandler: { rasterRevision: () => 0, getRasterTileStates },
    compositor: { renderRasterTiles, markDirty: vi.fn() },
    loadedTexs: new Map(),
    textureOptions: {
      maxAnisotropy: 1,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      useMipmaps: false,
      maxTextures: 4,
    },
    drapeRtSize: 512,
    texturizedSceneIndexFrom: 1,
    material: () => material,
    reportDrapeGpuBytes: vi.fn(),
  } as unknown as RasterDrapeHost);
  const syncMaterialSlots = () => resolver.syncMaterialSlots([null]);
  syncMaterialSlots();
  return {
    resolver,
    textures,
    getRasterTileStates,
    renderRasterTiles,
    syncMaterialSlots,
  };
}

describe("BakedRasterDrapeResolver.release", () => {
  it("frees the render targets and unbinds their slots", () => {
    const { resolver, textures } = makeResolver();
    resolver.update();
    expect(resolver.liveRenderTargetCount()).toBe(1);

    resolver.release();

    expect(resolver.liveRenderTargetCount()).toBe(0);
    expect(textures[0]).toBeNull();
  });

  it("allocates no render target on a material sync before the next update", () => {
    const { resolver, syncMaterialSlots } = makeResolver();
    resolver.update();
    resolver.release();

    syncMaterialSlots();

    expect(resolver.liveRenderTargetCount()).toBe(0);
  });

  it("bakes the resolved slots again on the next update without resolving them again", () => {
    const { resolver, textures, getRasterTileStates, renderRasterTiles } =
      makeResolver();
    resolver.update();
    resolver.release();

    resolver.update();

    expect(resolver.liveRenderTargetCount()).toBe(1);
    expect(textures[0]).not.toBeNull();
    expect(renderRasterTiles).toHaveBeenCalledTimes(2);
    expect(getRasterTileStates).toHaveBeenCalledTimes(1);
  });
});
