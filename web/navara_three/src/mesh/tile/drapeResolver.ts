import {
  LinearFilter,
  NearestFilter,
  type MagnificationTextureFilter,
  type MinificationTextureFilter,
  type Texture,
} from "three";

import type { TextureOptions } from "../../textures";

/**
 * A drape resolver owns one family of composite material slots for a terrain
 * tile: how its layers' pixels reach those slots (direct texture binding or an
 * offscreen bake into per-layer render targets), gated so the work only runs
 * when the Rust-side resolve or the backing content actually changed.
 *
 * Three implementations, side by side, spell out the rendering differences:
 * - {@link VectorDrapeResolver} (`vectorDrapeResolver.ts`) — clamp-to-ground
 *   vector layers. Always baked on every tiling scheme (vector content is an
 *   offscreen scene, so rasterizing is intrinsic); WebMercator terrain is the
 *   degenerate single-source identity case, Geographic terrain the N:M mosaic.
 * - `DirectRasterDrapeResolver` (`rasterDrapeResolver.ts`) — raster layers on
 *   WebMercator terrain. Same-scheme 1:1: the fetched tile texture is bound
 *   straight to its slot by `setupTextures`; every hook is a no-op.
 * - `BakedRasterDrapeResolver` (`rasterDrapeResolver.ts`) — raster layers on
 *   Geographic (quantized-mesh) terrain. Cross-scheme N:M mosaic bake with
 *   per-slot Mercator latitude reprojection.
 */
export type DrapeResolver = {
  /**
   * Per-frame hook (`_onBeforeRender`): refresh the Rust-resolved slots when
   * the resolve revision moved, and re-bake when the slot/content signature
   * changed (which also catches async content landing after the resolve).
   */
  update(): void;

  /**
   * `setupTextures` hook, after the material's per-slot arrays were rebuilt:
   * re-derive the resolver's slot pairing and rebind (or invalidate) its
   * textures. `textureFragments` holds the raster region's per-slot fragment
   * ids; the vector resolver ignores it (its region is positional).
   */
  syncMaterialSlots(
    textureFragments: readonly (string | null | undefined)[] | undefined,
  ): void;

  /**
   * Mercator latitude reprojection band (`[south, north]`, radians) for one of
   * this resolver's composite slots, or undefined when the slot samples
   * without reprojection.
   */
  slotReproject(absSlot: number): [number, number] | undefined;

  /**
   * Force a re-bake + re-bind on the next `update()` even though the resolved
   * slots are unchanged (e.g. picking passes repaint the offscreen content).
   */
  invalidate(): void;

  /**
   * Free the render targets of a tile that is not drawn. The next `update()`
   * allocates and bakes them again.
   */
  release(): void;

  /** Live drape render targets, counted into the tile's GPU byte report. */
  liveRenderTargetCount(): number;

  dispose(): void;
};

/** Apply the shared texturized-slot sampler settings to a drape render target's
 * texture. Returns the texture for call-site chaining.
 *
 * three allocates and regenerates the mip chain after every bake whenever
 * `generateMipmaps` is set, even if the min filter never samples it. */
export function configureTexturizedTexture(
  tex: Texture,
  textureOptions: TextureOptions,
): Texture {
  tex.minFilter = textureOptions.minFilter as MinificationTextureFilter;
  tex.magFilter = textureOptions.magFilter as MagnificationTextureFilter;
  tex.anisotropy = textureOptions.maxAnisotropy;
  tex.generateMipmaps =
    textureOptions.useMipmaps &&
    tex.minFilter !== LinearFilter &&
    tex.minFilter !== NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
