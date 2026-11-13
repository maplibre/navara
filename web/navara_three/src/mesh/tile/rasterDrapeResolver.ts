import { generate_id_from_ind_gen, type TileHandle } from "@navaramap/core";
import {
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  WebGLRenderTarget,
} from "three";

import type { TileHandler } from "../../event/context";
import type { TextureOptions } from "../../textures";
import type {
  RasterBakeSlot,
  TileTextureCompositor,
} from "../../tileTexture/TileTextureCompositor";
import { demNoDataColorBytes } from "../../utils/demNoDataColor";

import {
  configureTexturizedTexture,
  type DrapeResolver,
} from "./drapeResolver";

import type { TileMaterial } from ".";

/**
 * One WebMercator raster tile baked into a baked layer's render target, resolved
 * by Rust (`getRasterTileStates`). `fragmentId` keys the loaded texture in
 * `loadedTexs`; `uvOffset`/`uvScale` are the **mercator** affine framing the
 * terrain tile's sub-region of that (possibly ancestor-resolved) raster tile,
 * driving the bake camera.
 */
type RasterSource = {
  fragmentId: string;
  uvOffset: [number, number];
  uvScale: [number, number];
};

/**
 * One baked raster layer draped on this terrain tile. Rust emits one
 * fragment-less composite slot per baked layer; the k-th such slot pairs with
 * `ordinal == k` here, and every overlapping WM tile is baked into the slot's
 * one render target. `reproject` carries the terrain `[south, north]` band for
 * the composite's Mercator latitude remap.
 */
type RasterSlot = {
  ordinal: number;
  sources: RasterSource[];
  reproject?: [number, number];
};

/**
 * The raster half of the {@link DrapeResolver} family: how a terrain tile's
 * raster (non-hillshade) layers get their textures onto its composite material
 * slots. Two implementations express the WebMercator vs Geographic
 * (quantized-mesh terrain) rendering difference; the resolver is chosen once at
 * tile-mesh creation from `Globe.isGeographicTiling` — a runtime scheme flip
 * rebuilds every tile mesh (`init_globe_tiling` drains the tiling), so it
 * never changes mid-life.
 *
 * WebMercator terrain: raster tiles and terrain tiles share the tiling scheme,
 * so each layer drapes as a single identity (or ancestor-fallback) texture
 * through the regular per-slot material path — there is nothing to resolve,
 * bake, or reproject on this side.
 */
export class DirectRasterDrapeResolver implements DrapeResolver {
  update(): void {}
  syncMaterialSlots(): void {}
  slotReproject(): undefined {
    return undefined;
  }
  invalidate(): void {}
  release(): void {}
  liveRenderTargetCount(): number {
    return 0;
  }
  dispose(): void {}
}

/** The slice of TileMesh the baked resolver works against. `material` is an
 * accessor because the tile's material instance can be swapped over its life
 * (Basic ↔ Lambert). */
export type RasterDrapeHost = {
  handle: TileHandle;
  tileHandler: TileHandler;
  compositor: TileTextureCompositor;
  /** Decoded source textures keyed by fragment id (shared event-context map). */
  loadedTexs: Map<string, Texture>;
  textureOptions: TextureOptions;
  /** Drape render target side length in texels. */
  drapeRtSize: number;
  /** End of the raster slot region (`[0, texturizedSceneIndexFrom)`). */
  texturizedSceneIndexFrom: number;
  material: () => TileMaterial;
  /** Re-report the tile's drape GPU footprint after the RT pool changed. */
  reportDrapeGpuBytes: () => void;
};

/**
 * Geographic (quantized-mesh) terrain: WebMercator raster draped cross-scheme.
 * Owns the baked-slot pairing, the per-layer drape render-target pool and the
 * revision/signature gates, mirroring the texturized-vector drape path.
 * The material's k-th fragment-less non-hillshade slot (`bakedSlotIndices[k]`)
 * is backed by `rasterSlots[k]` baked into `renderTargets[k]`.
 */
export class BakedRasterDrapeResolver implements DrapeResolver {
  // Per-ordinal slots resolved by Rust and their render-target pool.
  private rasterSlots: (RasterSlot | undefined)[] = [];
  private renderTargets: (WebGLRenderTarget | undefined)[] = [];
  // The kind each pooled render target was configured for (heatmap = nearest /
  // NoColorSpace, color = linear / sRGB). Color space is fixed at GL allocation,
  // so a layer flipping kinds must get a fresh target, not a reconfigured one.
  private renderTargetIsHeatmap: (boolean | undefined)[] = [];
  // Absolute composite slot index per baked ordinal, derived from the material
  // in `syncMaterialSlots`.
  private bakedSlotIndices: number[] = [];
  private bakedSlotIsHeatmap: boolean[] = [];
  private prevSignature = "";
  private lastRevision = -1;
  // True once every resolved source's texture was present at bake time: the
  // signature can then only change via a slot refresh (revision bump / material
  // slot change), so the per-frame signature hashing is skipped until one.
  private signatureSettled = false;
  // Set by `release`: no render target is allocated until the next `update()`.
  private released = false;

  constructor(private readonly host: RasterDrapeHost) {}

  update(): void {
    if (this.bakedSlotIndices.length === 0) return;

    const wasReleased = this.released;
    this.released = false;
    // Gated exactly like the vector drape: refresh on the raster resolve
    // revision, re-bake on a slot/texture signature change.
    const revision = this.host.tileHandler.rasterRevision();
    if (revision !== this.lastRevision) {
      this.lastRevision = revision;
      this.refreshSlots();
      this.signatureSettled = false;
    } else if (wasReleased) {
      // The resolved slots still stand; only their targets are gone.
      this.syncRenderTargets();
    }
    if (!this.signatureSettled) {
      const signature = this.signature();
      if (signature !== this.prevSignature) {
        this.prevSignature = signature;
        this.bakeSlots();
      }
      // Once every resolved source's texture is present (and thus baked), the
      // signature is stable until the next refresh — skip hashing per frame.
      // A vanished texture always comes with a Rust-side destroy bump, which
      // refreshes and un-settles.
      this.signatureSettled = this.allTexturesLoaded();
    }
  }

  syncMaterialSlots(
    textureFragments: readonly (string | null | undefined)[] | undefined,
  ): void {
    // A non-hillshade raster slot with no fragment entity is backed by a
    // per-layer baked render target instead of a direct texture. The k-th such
    // slot pairs with `layer_ordinal == k` from `getRasterTileStates` — both
    // sides derive k from the same sorted layer list.
    const ud = this.host.material().userData;
    const prevIndices = this.bakedSlotIndices;
    const prevIsHeatmap = this.bakedSlotIsHeatmap;
    this.bakedSlotIndices = [];
    this.bakedSlotIsHeatmap = [];
    const isHillshades: boolean[] = ud.isHillshades?.value ?? [];
    const isHeatmaps: boolean[] = ud.isElevationHeatmaps?.value ?? [];
    const len = Math.min(
      textureFragments?.length ?? 0,
      this.host.texturizedSceneIndexFrom,
    );
    for (let i = 0; i < len; i++) {
      if (!textureFragments?.[i] && !isHillshades[i]) {
        this.bakedSlotIndices.push(i);
        this.bakedSlotIsHeatmap.push(!!isHeatmaps[i]);
      }
    }
    // The RT pool follows the baked slot count (disposes leftovers when layers
    // vanish).
    this.syncRenderTargets();
    const slotsChanged =
      prevIndices.length !== this.bakedSlotIndices.length ||
      this.bakedSlotIndices.some((v, i) => v !== prevIndices[i]) ||
      this.bakedSlotIsHeatmap.some((v, i) => v !== prevIsHeatmap[i]);
    if (slotsChanged) {
      // Slot pairing changed (layers added/removed/reordered): re-resolve + re-bake.
      this.prevSignature = "";
      this.signatureSettled = false;
    } else {
      // Same slots, and the render targets still hold the last bake — but the
      // material texture reset nulled the bindings, so rebind them without
      // paying a re-bake. Material updates fire on every tile activation during
      // camera motion; an unconditional signature reset here re-baked every such
      // tile every time (an FPS killer).
      this.bindSlots();
    }
  }

  slotReproject(absSlot: number): [number, number] | undefined {
    // Stashed by `setupTextures` from the Rust material: the per-slot flag plus
    // the tile-wide terrain `[south, north]` band. Baked slots have identity
    // UV, so the band recovered from the affine is exactly the terrain band.
    const ud = this.host.material().userData;
    const layerReproject: number[] = ud.layerReproject ?? [];
    const terrainLatRange: number[] = ud.terrainLatRange ?? [];
    return layerReproject[absSlot] === 1 && terrainLatRange.length === 2
      ? [terrainLatRange[0], terrainLatRange[1]]
      : undefined;
  }

  invalidate(): void {
    this.prevSignature = "";
    this.signatureSettled = false;
  }

  release(): void {
    if (this.liveRenderTargetCount() === 0) return;
    this.dispose();
    // The slots pointed at the disposed targets.
    this.bindSlots();
    this.released = true;
    this.invalidate();
  }

  liveRenderTargetCount(): number {
    let count = 0;
    for (const rt of this.renderTargets) {
      if (rt) count++;
    }
    return count;
  }

  dispose(): void {
    for (const rt of this.renderTargets) {
      rt?.dispose();
    }
    this.renderTargets.length = 0;
    this.renderTargetIsHeatmap.length = 0;
  }

  /**
   * Pull the Rust-resolved baked-raster states for this terrain tile into
   * {@link rasterSlots}: one slot per baked (non-hillshade) raster layer,
   * grouped by `layer_ordinal` — the raster twin of the vector-slot refresh.
   * An unloaded layer leaves a hole (its ordinal stays paired with its material
   * slot; the slot just stays transparent).
   */
  private refreshSlots() {
    const states =
      this.host.tileHandler.getRasterTileStates(this.host.handle) ?? [];

    const byOrdinal: (RasterSlot | undefined)[] = [];
    for (const state of states) {
      const ordinal = state.layer_ordinal;
      let slot = byOrdinal[ordinal];
      if (!slot) {
        const reproject = state.reproject_terrain_lat;
        slot = {
          ordinal,
          sources: [],
          reproject:
            reproject.length >= 2 ? [reproject[0], reproject[1]] : undefined,
        };
        byOrdinal[ordinal] = slot;
      }
      // Read each wasm getter once — every access crosses the boundary and the
      // uv getters allocate a fresh Float32Array.
      const uvOffset = state.uv_offset;
      const uvScale = state.uv_scale;
      slot.sources.push({
        fragmentId: generate_id_from_ind_gen(
          state.fragment_ind,
          state.fragment_gen,
        ),
        uvOffset: [uvOffset[0] ?? 0, uvOffset[1] ?? 0],
        uvScale: [uvScale[0] ?? 1, uvScale[1] ?? 1],
      });
      // wasm-bindgen objects hold Rust-heap memory; release it deterministically
      // instead of waiting for the GC's finalizer (see guide/WASM_API_POLICY.md).
      state.free();
    }

    this.rasterSlots = byOrdinal;
    this.syncRenderTargets();
  }

  /**
   * Size the render-target pool to the live baked slots: allocate lazily per
   * ordinal with sources, dispose when a layer vanishes. Heatmap layers get a
   * value-preserving target (nearest, `NoColorSpace`, no mips) so the encoded
   * DEM survives the bake; color layers mirror the vector drape targets
   * (`configureTexturizedTexture`) plus an sRGB declaration so the composite
   * decodes them exactly like the direct (non-baked) textures.
   */
  private syncRenderTargets() {
    const rts = this.renderTargets;
    const kinds = this.renderTargetIsHeatmap;
    const count = this.bakedSlotIndices.length;
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const active =
        !this.released && !!this.rasterSlots[ordinal]?.sources.length;
      const isHeatmap = this.bakedSlotIsHeatmap[ordinal];
      // A layer that flipped kinds (color ↔ heatmap via updateLayer) must not
      // reuse the old target: its color space is baked into the GL allocation,
      // and a heatmap baked into an sRGB/linear-filtered target decodes to
      // garbage elevations. Dispose and let the branch below re-allocate.
      if (rts[ordinal] && kinds[ordinal] !== isHeatmap) {
        rts[ordinal]?.dispose();
        rts[ordinal] = undefined;
      }
      if (active && !rts[ordinal]) {
        const rt = new WebGLRenderTarget(
          this.host.drapeRtSize,
          this.host.drapeRtSize,
          {
            format: RGBAFormat,
            depthBuffer: false,
            stencilBuffer: false,
          },
        );
        if (isHeatmap) {
          rt.texture.minFilter = NearestFilter;
          rt.texture.magFilter = NearestFilter;
          rt.texture.generateMipmaps = false;
          rt.texture.colorSpace = NoColorSpace;
        } else {
          configureTexturizedTexture(rt.texture, this.host.textureOptions);
          rt.texture.colorSpace = SRGBColorSpace;
        }
        rts[ordinal] = rt;
        kinds[ordinal] = isHeatmap;
      } else if (!active && rts[ordinal]) {
        rts[ordinal]?.dispose();
        rts[ordinal] = undefined;
      }
    }
    // Layers removed: drop targets past the live baked-slot count.
    for (let ordinal = count; ordinal < rts.length; ordinal++) {
      rts[ordinal]?.dispose();
    }
    rts.length = count;
    kinds.length = count;

    this.host.reportDrapeGpuBytes();
  }

  /**
   * Identity of the baked slot set + each source texture's availability. A change
   * means the sources must be re-baked and re-bound — including a texture arriving
   * in `loadedTexs` after the resolve (decode is async).
   */
  private signature(): string {
    const { loadedTexs } = this.host;
    return this.bakedSlotIndices
      .map((absSlot, ordinal) => {
        const sourceSig = this.rasterSlots[ordinal]?.sources
          .map(
            (s) =>
              `${s.fragmentId}@${s.uvOffset[0]},${s.uvOffset[1]},${s.uvScale[0]},${s.uvScale[1]}#${loadedTexs.has(s.fragmentId) ? 1 : 0}`,
          )
          .join(",");
        return `${absSlot}:${this.bakedSlotIsHeatmap[ordinal] ? 1 : 0}[${sourceSig ?? ""}]`;
      })
      .join("|");
  }

  /** Whether every resolved source's texture is present in `loadedTexs`. */
  private allTexturesLoaded(): boolean {
    const { loadedTexs } = this.host;
    for (const slot of this.rasterSlots) {
      if (!slot) continue;
      for (const source of slot.sources) {
        if (!loadedTexs.has(source.fragmentId)) return false;
      }
    }
    return true;
  }

  /**
   * Bake each baked layer's loaded source textures into its render target and
   * bind the targets to the material slots — the raster twin of the
   * `renderVectorScenes` + `bindVectorSlots` pair.
   */
  private bakeSlots() {
    const { loadedTexs } = this.host;
    const ud = this.host.material().userData;
    // The decoder's no-data color: painted under a baked heatmap's sources so
    // uncovered regions decode as "no elevation" (rendered transparent by the
    // composite) — the DEM alpha channel is never used for coverage.
    const noDataColor =
      demNoDataColorBytes(
        ud.elevationRGBScaler?.value ?? { x: 0, y: 0, z: 0 },
        ud.elevationMinMaxHeightAndBoundary?.value.z ?? 0,
      ) ?? undefined;
    const bakeSlots: (RasterBakeSlot | undefined)[] = this.bakedSlotIndices.map(
      (_, ordinal) => {
        const slot = this.rasterSlots[ordinal];
        // No resolved sources → no live render target for this ordinal.
        if (!slot?.sources.length) return undefined;
        const isElevationHeatmap = this.bakedSlotIsHeatmap[ordinal];
        // Loaded textures only; a slot whose textures are all still decoding
        // keeps its (cleared + no-data-painted) target until they land.
        const sources = slot.sources.flatMap((s) => {
          const texture = loadedTexs.get(s.fragmentId);
          return texture
            ? [{ texture, uvOffset: s.uvOffset, uvScale: s.uvScale }]
            : [];
        });
        return {
          isElevationHeatmap,
          noDataColor: isElevationHeatmap ? noDataColor : undefined,
          sources,
        };
      },
    );
    this.host.compositor.renderRasterTiles(bakeSlots, this.renderTargets);
    this.bindSlots();
    this.host.compositor.markDirty(this.host.handle, "raster-revision");
  }

  /**
   * Bind each baked layer's render target to its material slot. Shows, colors
   * and opacities already cross via the material's per-slot arrays (the baked
   * slot is a regular material slot, just fragment-less); only the texture is
   * bound here. A slot with no target yet stays `null`, which the composite
   * skips — transparent until the first source texture arrives.
   */
  private bindSlots() {
    const textures = this.host.material()?.userData?.textures?.value;
    if (!textures) return;
    for (let ordinal = 0; ordinal < this.bakedSlotIndices.length; ordinal++) {
      const absSlot = this.bakedSlotIndices[ordinal];
      textures[absSlot] = this.renderTargets[ordinal]?.texture ?? null;
    }
  }
}
