import type { TileHandle } from "@navaramap/core";
import {
  Color,
  DataTexture,
  RGBAFormat,
  WebGLRenderTarget,
  type Object3D,
  type Vector2,
} from "three";

import type { TileHandler } from "../../event/context";
import type { TexturizedSceneByTileCoordinates } from "../../scene";
import type { TextureOptions } from "../../textures";
import type { TileTextureCompositor } from "../../tileTexture";
import { PolygonMesh } from "../polygon";
import { PolylineMesh } from "../polyline";

import {
  configureTexturizedTexture,
  type DrapeResolver,
} from "./drapeResolver";

import type { TileMaterial } from ".";

/**
 * One WebMercator vector source tile baked into a layer's render target.
 * `tileHandle` keys the cached offscreen scene; `uvOffset`/`uvScale` are the
 * **mercator** affine framing the terrain tile's sub-region of that (possibly
 * coarser, ancestor-resolved) source tile, driving the bake camera (identity for
 * an exact same-tile drape).
 */
type VectorSource = {
  tileHandle: TileHandle;
  uvOffset: [number, number];
  uvScale: [number, number];
};

/**
 * One clamp-to-ground vector layer draped on this terrain tile, resolved by Rust.
 * A layer is backed by one source on WebMercator terrain, but by several when the
 * terrain is Geographic (N:M): every overlapping WM vector tile is baked into the
 * layer's single render target, each framed by its own `uvOffset`/`uvScale`, so
 * the RT ends up spanning the terrain tile's extent. `reproject` carries the
 * terrain `[south, north]` band on Geographic terrain (undefined on WM) so the
 * composite paste can remap the latitude axis WebMercator→Geographic, exactly
 * like a raster slot.
 */
type VectorSlot = {
  layerId: string;
  sources: VectorSource[];
  reproject?: [number, number];
};

/** Shared 1×1 transparent texture bound to texturized sampler slots that have
 * no drape render target yet (they are allocated lazily). WebGL requires every
 * sampler to reference a valid texture; the shader gates sampling with `shows`,
 * so this placeholder's content is never visible. */
const EMPTY_TEXTURIZED_TEXTURE = new DataTexture(
  new Uint8Array([0, 0, 0, 0]),
  1,
  1,
  RGBAFormat,
);
EMPTY_TEXTURIZED_TEXTURE.needsUpdate = true;

/** The slice of TileMesh the vector resolver works against. `material` is an
 * accessor because the tile's material instance can be swapped over its life
 * (Basic ↔ Lambert). */
export type VectorDrapeHost = {
  handle: TileHandle;
  tileHandler: TileHandler;
  compositor: TileTextureCompositor;
  /** Offscreen per-(tile, layer) vector scenes the bake rasterizes. */
  texturizedScenes: TexturizedSceneByTileCoordinates;
  textureOptions: TextureOptions;
  /** Drape render target side length in texels. */
  drapeRtSize: number;
  /** Texturized-vector slot budget (the region's width). */
  numTexturizedVector: number;
  /** First texturized-vector slot index (the region is `[from, maxTextures)`). */
  texturizedSceneIndexFrom: number;
  material: () => TileMaterial;
  /** Re-report the tile's drape GPU footprint after the RT pool changed. */
  reportDrapeGpuBytes: () => void;
};

/**
 * Clamp-to-ground vector layers: always the baked path, on every tiling scheme.
 * Vector content is an offscreen three.js scene, so rasterizing into a
 * per-layer render target is intrinsic — WebMercator terrain is just the
 * degenerate case (one source, identity affine, no reprojection band) of the
 * Geographic N:M mosaic. That is why, unlike the raster side, there is no
 * direct/baked split here.
 */
export class VectorDrapeResolver implements DrapeResolver {
  // Per-layer texturized-vector slots resolved by Rust: one slot per
  // clamp-to-ground layer, keyed by the WM vector tile whose offscreen scene
  // backs it. Ancestor fallback is already resolved in Rust, so this side just
  // caches + bakes.
  private vectorSlots: VectorSlot[] = [];
  private renderTargets: WebGLRenderTarget[] = [];
  // Signature of the last baked slot set; a change drives a re-bake + re-bind.
  private prevSignature = "";
  // The vector resolution revision at which `vectorSlots` was last fetched.
  // Re-fetching is skipped while the global revision is unchanged (the resolve
  // result can only change when a traverse runs or a scene becomes ready).
  // `-1` forces a fetch on the first frame.
  private lastRevision = -1;
  private warnedExceededTextures = false;
  // Whether the next bakes render pick-id colors. Pick bakes bypass the MSAA
  // path: the resolve averages id-encoded colors along feature edges into
  // batch ids that don't exist (see renderVectorScenes).
  private pickBake = false;

  constructor(private readonly host: VectorDrapeHost) {}

  /** Toggle pick-id baking; forces a re-bake so the mode change lands. */
  setPickBake(on: boolean): void {
    this.pickBake = on;
    this.prevSignature = "";
  }

  update(): void {
    // Re-fetch the Rust-resolved slots only when the global vector resolution
    // revision changed; otherwise reuse the cached slots. This skips a per-tile
    // WASM-boundary resolve every frame, the dominant steady-state cost when
    // many terrain tiles are visible.
    const revision = this.host.tileHandler.vectorRevision();
    if (revision !== this.lastRevision) {
      this.lastRevision = revision;
      this.refreshSlots();
    }

    // Re-bake the offscreen vector scenes only when the resolved slots or their
    // backing scenes changed; otherwise the existing render targets stay valid.
    const signature = this.signature();
    if (signature !== this.prevSignature) {
      this.prevSignature = signature;
      this.host.compositor.renderVectorScenes(
        this.vectorSlots,
        this.renderTargets,
        { antialias: !this.pickBake },
      );
      this.bindSlots();
      this.host.compositor.markDirty(this.host.handle, "vector-revision");
    }
  }

  syncMaterialSlots(): void {
    const m = this.host.material();
    const textures = m.userData.textures.value;
    for (let i = 0; i < this.host.numTexturizedVector; i++) {
      // Every texturized sampler slot must reference a valid texture (GLSL/WebGL
      // requires it even for a sampler never read). Drape render targets are
      // allocated lazily, so a slot without one binds the shared empty texture;
      // `bindSlots` swaps in the real RT texture once a layer drapes here.
      const lastIndex = this.host.texturizedSceneIndexFrom + i;
      const rt = this.renderTargets[i];
      textures[lastIndex] = rt
        ? configureTexturizedTexture(rt.texture, this.host.textureOptions)
        : EMPTY_TEXTURIZED_TEXTURE;

      // Per-slot visibility + material attributes are bound by bindSlots once
      // the Rust-resolved slots are known; default to hidden here.
      m.userData.shows.value[lastIndex] = 0;
      m.userData.colors.value[lastIndex] = new Color(0xffffff);
      m.userData.opacities.value[lastIndex] = 1.0;
    }
    // Re-bind vector slots on the next frame now that render targets were rebound.
    this.prevSignature = "";
  }

  slotReproject(absSlot: number): [number, number] | undefined {
    // Baked-vector slots (whose RT spans the terrain extent) carry the
    // Rust-resolved terrain `[south, north]` band directly on the slot;
    // undefined on WebMercator terrain.
    return this.vectorSlots[absSlot - this.host.texturizedSceneIndexFrom]
      ?.reproject;
  }

  invalidate(): void {
    this.prevSignature = "";
  }

  liveRenderTargetCount(): number {
    return this.renderTargets.length;
  }

  dispose(): void {
    for (const rt of this.renderTargets) {
      rt.dispose();
    }
    this.renderTargets.length = 0;
  }

  /**
   * Pull the Rust-resolved texturized-vector slots for this terrain tile into
   * {@link vectorSlots}: one bake slot per clamp-to-ground layer, keyed by the
   * rendered WM vector tile that backs it (ancestor fallback already resolved in
   * Rust). Only layers with an actual draped scene take a slot — Rust also returns
   * non-draped layers (rendered in the MRT scene), which must not consume the budget.
   * Capped to the GPU slot budget; warns once when more draped layers are requested.
   */
  private refreshSlots() {
    const states =
      this.host.tileHandler.getVectorTileStates(this.host.handle) ?? [];

    // Group the flattened per-(layer, source) states back into one slot per
    // layer, each carrying every overlapping WM source tile (N:M on Geographic
    // terrain). First-seen layer order assigns the render-target index, kept
    // consistent by renderVectorScenes / bindSlots / buildCompositeLayers.
    const byLayer = new Map<string, VectorSlot>();
    const droppedLayers = new Set<string>();
    for (const state of states) {
      // Read each wasm getter once — every access crosses the boundary and the
      // uv getters allocate a fresh Float32Array.
      const layerId = state.layer_id;
      const tileHandle = state.tile_handle;
      let slot = byLayer.get(layerId);
      if (!slot) {
        // Rust returns a state for every vector layer with a rendered tile, including
        // non-draped layers (those render in the MRT scene and never create a texturized
        // scene). Only a layer that actually has a draped scene may consume a bake slot;
        // otherwise non-draped layers would occupy the limited slot budget and crowd out
        // genuinely-draped layers past the cap. A draped layer whose scene isn't ready yet
        // simply gets no slot this pass and is picked up once its scene exists.
        const hasScene =
          this.host.texturizedScenes.findSceneByLayerId(tileHandle, layerId) !=
          null;
        if (!hasScene) {
          state.free();
          continue;
        }
        // Cap the layer fan-out to the GPU slot budget; extra layers are dropped.
        if (byLayer.size >= this.host.numTexturizedVector) {
          droppedLayers.add(layerId);
          state.free();
          continue;
        }
        const reproject = state.reproject_terrain_lat;
        slot = {
          layerId,
          sources: [],
          reproject:
            reproject.length >= 2 ? [reproject[0], reproject[1]] : undefined,
        };
        byLayer.set(layerId, slot);
      }
      const uvOffset = state.uv_offset;
      const uvScale = state.uv_scale;
      slot.sources.push({
        tileHandle,
        uvOffset: [uvOffset[0] ?? 0, uvOffset[1] ?? 0],
        uvScale: [uvScale[0] ?? 1, uvScale[1] ?? 1],
      });
      // wasm-bindgen objects hold Rust-heap memory; release it deterministically
      // instead of waiting for the GC's finalizer (see guide/WASM_API_POLICY.md).
      state.free();
    }

    if (droppedLayers.size > 0) {
      if (!this.warnedExceededTextures) {
        this.warnedExceededTextures = true;
        console.warn(
          `[TileMesh] Exceeded maximum MVT texture slots: ${byLayer.size + droppedLayers.size} layers requested, ` +
            `but only ${this.host.numTexturizedVector} slots available. ` +
            `Some MVT layers will not be rendered.`,
        );
      }
    } else {
      this.warnedExceededTextures = false;
    }

    this.vectorSlots = [...byLayer.values()];
    this.syncRenderTargets();
  }

  /**
   * Size the drape render-target pool to the live slot count (already capped to
   * `numTexturizedVector` by {@link refreshSlots}): allocate the ones a
   * newly-draped layer needs, dispose the ones a vanished layer freed. Then
   * report the pool's GPU footprint to the memory ledger so it tracks drape
   * memory that scales with terrain subdivision past the vector maxZoom — a cost
   * per-vector-tile accounting cannot see. Reports only when the count changes.
   */
  private syncRenderTargets() {
    const target = this.vectorSlots.length;
    const rts = this.renderTargets;
    while (rts.length < target) {
      const rt = new WebGLRenderTarget(
        this.host.drapeRtSize,
        this.host.drapeRtSize,
        {
          format: RGBAFormat,
        },
      );
      // Match the sampler settings syncMaterialSlots applies to rebound RTs,
      // so the lazily-grown one binds identically when bindSlots picks it up.
      configureTexturizedTexture(rt.texture, this.host.textureOptions);
      rts.push(rt);
    }
    while (rts.length > target) {
      rts.pop()?.dispose();
    }

    this.host.reportDrapeGpuBytes();
  }

  /**
   * Identity of the current slot set + the backing scenes' content. A change means
   * the offscreen scenes must be re-baked and the per-slot material state re-bound.
   */
  private signature(): string {
    return this.vectorSlots
      .map((slot) => {
        const sourceSig = slot.sources
          .map((s) => {
            const scene = this.host.texturizedScenes.findSceneByLayerId(
              s.tileHandle,
              slot.layerId,
            );
            return `${s.tileHandle}@${s.uvOffset[0]},${s.uvOffset[1]},${s.uvScale[0]},${s.uvScale[1]}#${scene?.revision ?? -1}:${scene?.children.length ?? 0}`;
          })
          .join(",");
        return `${slot.layerId}[${sourceSig}]`;
      })
      .join("|");
  }

  /**
   * Drive each vector slot's main-shader state: texture, per-slot UV transform,
   * visibility and the draped mesh's material attributes. One slot per layer,
   * sourced from the WM vector tile the Rust resolve picked. The resolve walks
   * up to the nearest rendered tile (readiness derived from ECS activation /
   * the Rust resolve, not a JS-side scene_ready flag), so the slot's scene is
   * always bakeable (its own render target was framed by the bake) and the UV
   * is identity — the ancestor LOD fallback lives entirely in Rust.
   */
  private bindSlots() {
    const m = this.host.material();
    if (!m || !m.userData || !m.userData.textures?.value) return;
    const textures = m.userData.textures.value;
    const uvOffsets: Vector2[] = m.userData.layerUvOffset?.value ?? [];
    const uvScales: Vector2[] = m.userData.layerUvScale?.value ?? [];

    for (let i = 0; i < this.host.numTexturizedVector; i++) {
      const lastIdx = this.host.texturizedSceneIndexFrom + i;
      const ownRt = this.renderTargets[i];
      // Slots past the live pool (lazily sized to the draped-layer count) have
      // no render target: hide the slot and rebind the shared empty texture so
      // the shader never samples a stale / disposed texture from a layer that
      // is no longer draped here.
      if (!ownRt) {
        m.userData.shows.value[lastIdx] = 0;
        textures[lastIdx] = EMPTY_TEXTURIZED_TEXTURE;
        continue;
      }

      textures[lastIdx] = ownRt.texture;
      // The bake framed every source into this RT so it spans the terrain tile's
      // extent: the paste samples it 1:1 in longitude (identity UV here); the
      // latitude axis is reprojected WebMercator→Geographic in the composite
      // shader via the slot's reproject band (see `slotReproject`).
      uvOffsets[lastIdx]?.set(0, 0);
      uvScales[lastIdx]?.set(1, 1);

      const slot = this.vectorSlots[i];
      const mesh = slot ? this.representativeMesh(slot) : undefined;
      m.userData.shows.value[lastIdx] = mesh ? 1 : 0;
      if (mesh) this.copyMeshAttrs(lastIdx, mesh);
    }
  }

  /**
   * First available draped mesh backing any of a layer's sources. A clamp-to-ground
   * layer's material attributes (water/specular/emissive/…) are uniform across its
   * tiles, so any source's mesh is a faithful representative for the slot.
   */
  private representativeMesh(slot: VectorSlot): Object3D | undefined {
    for (const source of slot.sources) {
      const scene = this.host.texturizedScenes.findSceneByLayerId(
        source.tileHandle,
        slot.layerId,
      );
      if (scene && !scene.removed && scene.children.length) {
        return scene.children[0];
      }
    }
    return undefined;
  }

  /** Copy a draped mesh's material attributes into the main shader's slot `lastIdx`. */
  private copyMeshAttrs(lastIdx: number, mesh: Object3D) {
    const m = this.host.material();
    if (mesh instanceof PolygonMesh) {
      // Use PolygonMesh getters that expose material enhancer state
      m.userData.reflectivities.value[lastIdx] = mesh.reflectivity;
      m.userData.roughnesses.value[lastIdx] = mesh.roughness;
      m.userData.waters.value[lastIdx] = mesh.water;
      m.userData.waterScaleNormals.value[lastIdx] = mesh.waterScaleNormal;
      m.userData.waterSpeeds.value[lastIdx] = mesh.waterSpeed;
      m.userData.shininesses.value[lastIdx] = mesh.shininess;
      m.userData.specularStrengths.value[lastIdx] = mesh.specularStrength;
      m.userData.applyWaterNormals.value[lastIdx] = mesh.applyWaterNormal;
      m.userData.speculars.value[lastIdx] = mesh.specular;
      m.userData.emissiveIntensities.value[lastIdx] = mesh.emissiveIntensity;
      m.userData.emissiveColors.value[lastIdx].set(mesh.emissiveColor);
      m.userData.effectIdsMasks.value[lastIdx] = mesh.effectIdsMask;
    } else if (mesh instanceof PolylineMesh) {
      m.userData.emissiveIntensities.value[lastIdx] = mesh.emissiveIntensity;
      m.userData.emissiveColors.value[lastIdx].set(mesh.emissiveColor);
      m.userData.effectIdsMasks.value[lastIdx] = mesh.effectIdsMask;
    }
  }
}
