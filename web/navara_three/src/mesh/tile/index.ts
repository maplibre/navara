import { generate_id_from_entity, type TileHandle } from "@navaramap/core";
import type {
  MeshAdded,
  Mesh as EventMesh,
  RasterTileInternalMaterial,
  Transform,
  TextureFragment,
  MeshChanged,
  Globe,
} from "@navaramap/engine";
import BranchFreeTernary from "@shaders/glsl/chunks/branchFreeTernary.glsl?raw";
import SpecularParsFragment from "@shaders/glsl/chunks/spucular_pars_fragment.glsl";
import WaterParsFragment from "@shaders/glsl/chunks/water_pars_fragment.glsl";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  NearestFilter,
  Mesh,
  MeshLambertMaterial,
  RedFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  AddOperation,
  Object3D,
  type MagnificationTextureFilter,
  type MinificationTextureFilter,
  ShaderChunk,
  Box3,
  Box3Helper,
  NoColorSpace,
  MeshBasicMaterial,
  LinearFilter,
} from "three";
import invariant from "tiny-invariant";

import { setTransform } from "../../event";
import type { EventContext, TileHandler } from "../../event/context";
import {
  GBUFFER_EFFECT_WRITE_BUILTIN,
  GBUFFER_NORMAL_WRITE_BASIC,
  GBUFFER_PHONG_ROUGHNESS,
  generateTileCommonInjection,
  generateTileMapFragment,
  generateTileNormalBufferReplacement,
  generateTileNormalFragmentMaps,
  generateTileOutgoingLight,
  TILE_EMISSIVE_EFFECT_BUFFER_REPLACEMENT,
  generateTileWaterDefines,
  TILE_PICK_FRAGMENT_OVERRIDE,
  TILE_VERTEX_INJECTIONS,
  applyLitOption,
} from "../../material";
import { deriveCompositeFeatures } from "../../material/enhancer/tileComposite";
import type { CustomObject3DEventMap } from "../../object3DEvent";
import type { TextureOptions } from "../../textures";
import {
  atlasUniforms,
  DEFAULT_ELEVATION_HEATMAP_LOG_BOUNDARY,
  planSlots,
  type CompositeFeatures,
  type CompositeGlobals,
  type CompositeLayer,
  type TileTextureCompositor,
} from "../../tileTexture";
import type { TileMapByHandle } from "../../type";
import type { CommonUniforms } from "../../uniforms";
import { createReplacer } from "../../utils";
import {
  type TextureSlot,
  updateTextureFragmentIndex,
  removeTextureFragmentIndex,
} from "../../utils/textureFragmentIndex";
import {
  DEFAULT_WAVE_CONDITIONS,
  type WaterWavesRef,
} from "../../water/waterState";
import type { PickableMesh } from "../pickableMesh";
import { releaseGeometryArraysAfterUpload } from "../releaseGeometryArrays";

import type { DrapeResolver } from "./drapeResolver";
import {
  BakedRasterDrapeResolver,
  DirectRasterDrapeResolver,
} from "./rasterDrapeResolver";
import {
  exaggeratedTerrainBounds,
  injectTerrainExaggeration,
  terrainDepthMaterial,
} from "./terrainExaggeration";
import { VectorDrapeResolver } from "./vectorDrapeResolver";

export type TileMaterial = MeshBasicMaterial | MeshLambertMaterial;

/** GPU bytes for one drape render target at side length `size`: size² RGBA. */
function drapeRtBytes(size: number): number {
  return size * size * 4;
}

export class TileMesh
  extends Mesh<BufferGeometry, TileMaterial, CustomObject3DEventMap>
  implements PickableMesh
{
  handle: TileHandle;
  tileHandler: TileHandler;
  maxTextures: number;
  texturizedSceneIndexFrom: number;
  numTexturizedVector: number;

  // The tile's two drape resolvers (see `drapeResolver.ts`): the vector one is
  // always the baked path (WebMercator is its degenerate identity case), the
  // raster one is chosen at construction from the globe tiling scheme —
  // direct 1:1 material slots on WebMercator terrain, baked per-layer render
  // targets (with Mercator latitude reprojection) on Geographic terrain.
  // Concrete type: pick baking (setPickBake) is vector-drape-specific.
  private readonly vectorDrape: VectorDrapeResolver;
  private readonly rasterDrape: DrapeResolver;

  // Index count of the terrain surface, which sits in front of the skirt in
  // the geometry's index buffer.
  private terrainIndexCount = 0;
  private boundingBoxHelper?: Box3Helper;
  // Unexaggerated geometry bounds (`Mesh::aabb`) and the height range they
  // span (`Mesh::min_height`/`max_height`), kept to rebuild the exaggerated bounds
  // when the exaggeration changes.
  private rawBounds = {
    center: new Vector3(),
    extent: new Vector3(),
    minHeight: 0,
    maxHeight: 0,
  };

  private compositor: TileTextureCompositor;

  // Drape RT side length, read from the compositor (the single source of truth
  // shared with the Rust cost hints) in the constructor. Per-instance rather
  // than a module constant because the compositor size is a runtime value
  // (512² on both desktop and mobile today, but configurable).
  private readonly drapeRtSize: number;
  /** Current `Mesh::fill_quadrants` mask (see `setFillQuadrants`). */
  private fillQuadrants = 0;
  // Drape footprint (bytes) last reported to the memory ledger, so a report
  // only crosses the WASM boundary when it actually changes. Starts at 0 to
  // match the drape term Rust seeds at mesh-attach time.
  private reportedDrapeGpuBytes = 0;
  // Whether the frame being rendered drew this tile.
  private drawnInFrame = false;
  // Whether the tile gave its drape memory back since it was last drawn.
  private drapeGpuMemoryReleased = false;
  private _waterMaskWaves: WaterWavesRef | undefined;

  readonly ctx: EventContext;

  constructor(ctx: EventContext, mesh: MeshAdded) {
    super();
    this.ctx = ctx;

    const {
      texturizedSceneByTileCoordinates,
      tileTextureCompositor,
      textureOptions,
      tileMapByHandle,
      tileHandler,
    } = ctx;

    const handle = mesh.tile_handle;
    this.handle = handle;

    this.compositor = tileTextureCompositor;

    // Device-dependent atlas / drape RT sizing, sourced from the compositor so
    // it always matches the ledger cost hints (see device.ts).
    this.drapeRtSize = this.compositor.size;

    // Acquire the per-tile composite atlas from the compositor. Pairing the
    // acquire with the mesh keeps the atlas lifecycle tied to the tile and lets
    // the compositor allocate its private OrthographicCamera for this handle.
    // The atlas Textures are bound to the main shader later in initMaterial.
    this.compositor.acquire(handle);

    this.maxTextures = textureOptions.maxTextures;

    // Calculate numAdditionalTextures based on which additional textures are in use
    const additionalTexturesInUse =
      textureOptions.additionalTexturesInUse ?? {};
    let numAdditionalTextures = 0;
    if (additionalTexturesInUse.colorMapTexture) numAdditionalTextures++;

    this.numTexturizedVector =
      Math.floor(textureOptions.maxTextures / 2) - numAdditionalTextures;
    this.texturizedSceneIndexFrom = this.maxTextures - this.numTexturizedVector;

    // Drape render targets are allocated lazily (see `ensureRenderTargets`),
    // one per live clamp-to-ground layer draped onto this tile — most terrain
    // tiles drape 0–2 layers, so eagerly reserving `numTexturizedVector` (~5)
    // drape targets per tile wasted GPU memory and, worse, scaled with terrain
    // subdivision past the vector maxZoom (a mobile OOM driver).

    this.tileHandler = tileHandler;

    // Vector layers always resolve through the baked drape path (WebMercator
    // terrain is its degenerate identity case).
    this.vectorDrape = new VectorDrapeResolver({
      handle,
      tileHandler,
      compositor: this.compositor,
      texturizedScenes: texturizedSceneByTileCoordinates,
      textureOptions,
      drapeRtSize: this.drapeRtSize,
      numTexturizedVector: this.numTexturizedVector,
      texturizedSceneIndexFrom: this.texturizedSceneIndexFrom,
      material: () => this.material,
      reportDrapeGpuBytes: () => this.reportDrapeGpuBytesIfChanged(),
    });

    // The globe tiling scheme is fixed for this mesh's lifetime (a runtime
    // scheme flip drains and rebuilds every tile), so the raster drape
    // resolver is chosen once here. `mesh.globe` clones a wasm object;
    // release it.
    const globe = mesh.globe;
    const isGeographicTiling = globe.isGeographicTiling;
    globe.free();
    this.rasterDrape = isGeographicTiling
      ? new BakedRasterDrapeResolver({
          handle,
          tileHandler,
          compositor: this.compositor,
          loadedTexs: ctx.loadedTexs,
          textureOptions,
          drapeRtSize: this.drapeRtSize,
          texturizedSceneIndexFrom: this.texturizedSceneIndexFrom,
          material: () => this.material,
          reportDrapeGpuBytes: () => this.reportDrapeGpuBytesIfChanged(),
        })
      : new DirectRasterDrapeResolver();

    tileMapByHandle.set(handle, this);
    // The atlas shared with the mesh this one replaces may already be
    // allocated.
    this.reportDrapeGpuBytesIfChanged();

    this.onBeforeRender = this._onBeforeRender;
    this.onBeforeShadow = this._onBeforeShadow;
    this.onAfterShadow = this._onAfterShadow;
  }

  /**
   * Report the tile's drape GPU footprint (composite atlas + vector and baked-raster
   * drape render targets) to the memory ledger when it changed. The atlas counts while
   * it is allocated, regardless of draping;
   * it grows by the normal attachment while the tile has hillshade.
   * The render targets on top of it scale with terrain subdivision past the layers'
   * maxZoom — a cost per-source-tile accounting cannot see.
   */
  private reportDrapeGpuBytesIfChanged() {
    // Only the mesh currently registered for this position-stable handle may
    // report. During a terrain mesh replacement the outgoing mesh briefly
    // coexists with the incoming one, which has already claimed the handle
    // (constructor's `tileMapByHandle.set`) and been seeded by
    // `attach_terrain_mesh_cost`. A stray report from the outgoing mesh would
    // resolve on the Rust side (via `Without<Deleted>`) to the NEW live entity
    // and overwrite its drape cost — the same hazard the dispose() 0-report
    // guards against, here on the non-zero path. The two meshes share the
    // handle's atlas, so a change the outgoing mesh makes to it (a bake that
    // allocates or reshapes it) is reported by the registered mesh instead.
    const owner = this.ctx.tileMapByHandle.get(this.handle);
    if (owner !== this) {
      owner?.reportDrapeGpuBytesIfChanged();
      return;
    }
    const rtCount =
      this.vectorDrape.liveRenderTargetCount() +
      this.rasterDrape.liveRenderTargetCount();
    const bytes =
      this.compositor.atlasGpuBytes(this.handle) +
      rtCount * drapeRtBytes(this.drapeRtSize);
    if (bytes === this.reportedDrapeGpuBytes) return;
    this.reportedDrapeGpuBytes = bytes;
    this.tileHandler.reportDrapeGpuBytes(this.handle, bytes);
  }

  /**
   * Called after each rendered frame. A tile the frame did not draw (hidden,
   * or outside every camera) frees its drape render targets and composite
   * atlas; its next render bakes them again.
   */
  releaseDrapeGpuMemoryUnlessDrawn() {
    if (this.drawnInFrame) {
      this.drawnInFrame = false;
      this.drapeGpuMemoryReleased = false;
      return;
    }
    if (this.drapeGpuMemoryReleased) return;
    this.vectorDrape.release();
    this.rasterDrape.release();
    this.drapeGpuMemoryReleased = this.compositor.releaseAtlas(this.handle);
    this.reportDrapeGpuBytesIfChanged();
  }

  private _onBeforeRender = () => {
    if (!this.visible) return;
    this.drawnInFrame = true;

    // Drape resolvers (see `drapeResolver.ts`): each refreshes its Rust-resolved
    // slots on a revision bump and re-bakes on a slot/content signature change.
    // The raster one is a no-op on WebMercator terrain (direct 1:1 slots).
    this.vectorDrape.update();
    this.rasterDrape.update();

    // MRT composite pass: bakes N source textures into the per-tile atlas.
    // Skip building the layer snapshot entirely when nothing is dirty.
    if (!this.compositor.cache.isDirty(this.handle)) return;
    const { layers, globals } = this.buildCompositeLayers();
    const plan = planSlots(
      layers,
      this.texturizedSceneIndexFrom,
      this.maxTextures,
    );
    const baked = this.compositor.runCompositePassIfDirty(
      this.handle,
      plan,
      globals,
      deriveCompositeFeatures(layers, globals),
      // The atlas carries the normal attachment for its only reader: the
      // main shader's hillshade branch.
      this.computeFeatures().hasHillshade,
    );
    if (baked) this.reportDrapeGpuBytesIfChanged();
  };

  // The skirt casts no shadow.
  private _onBeforeShadow = () => {
    this.geometry.setDrawRange(0, this.terrainIndexCount);
  };

  private _onAfterShadow = () => {
    this.geometry.setDrawRange(0, Infinity);
  };

  /** The waves of the watermask's water, held for as long as the tile lives. */
  private waterMaskWaves(): WaterWavesRef {
    this._waterMaskWaves ??= this.ctx.uniforms.water.createWaves(
      DEFAULT_WAVE_CONDITIONS,
    );
    return this._waterMaskWaves;
  }

  /**
   * Feature flags for the **main** TileMesh shader (atlas-sampling side): drives
   * its program cache key and which normal/specular branches compile. Sourced
   * from the material defines/userData, independent of the composite pass's own
   * (layer-derived) feature set — see {@link deriveCompositeFeatures}.
   */
  private computeFeatures(): CompositeFeatures {
    const ud = this.material.userData;
    // Only slots that are still shown count: bindVectorSlots sets shows=0 when a
    // slot loses its representative mesh but leaves the per-slot water/elevation heatmap
    // uniforms at their previous values, so a disappeared layer would otherwise
    // keep its shader feature (e.g. water) compiled in. Mirrors the shows gate in
    // buildCompositeLayers.
    const shows: number[] = ud.shows?.value ?? [];
    const waterParams = ud.waterParams?.value as Vector2[] | undefined;
    const elevationHeatmaps = ud.isElevationHeatmaps?.value as
      boolean[] | undefined;
    return {
      hasHillshade: ud.defines?.USE_HILLSHADE === 1,
      hasWater: !!waterParams?.some((v, i) => v.y > 0 && shows[i] === 1),
      hasElevationHeatmap: !!elevationHeatmaps?.some(
        (v, i) => v === true && shows[i] === 1,
      ),
      hasWatermask: this.userData.watermask != null,
    };
  }

  /**
   * Snapshot the current per-slot uniform state into a typed layer list for the
   * compositor's MRT pass. Reads directly from material.userData (the same
   * source of truth the main shader uses); only slots that are both shown and
   * textured become layers, so the SlotPlanner's compact counts cover exactly
   * the active slots.
   */
  private buildCompositeLayers(): {
    layers: CompositeLayer[];
    globals: CompositeGlobals;
  } {
    const ud = this.material.userData;
    const shows: number[] = ud.shows?.value ?? [];
    const textures: (Texture | null)[] = ud.textures?.value ?? [];
    const colors: Color[] = ud.colors?.value ?? [];
    const opacities: number[] = ud.opacities?.value ?? [];
    const layerUvOffset: Vector2[] = ud.layerUvOffset?.value ?? [];
    const layerUvScale: Vector2[] = ud.layerUvScale?.value ?? [];
    const isHillshades: boolean[] = ud.isHillshades?.value ?? [];
    const isElevationHeatmaps: boolean[] = ud.isElevationHeatmaps?.value ?? [];
    const elevationHeatmapUsesBilinear: boolean[] =
      ud.elevationHeatmapUsesBilinear?.value ?? [];
    const elevationHeatmapLayerIds: (string | undefined)[] =
      ud.elevationHeatmapLayerIds?.value ?? [];
    const elevationMinHeights: number[] = ud.elevationMinHeights?.value ?? [];
    const elevationMaxHeights: number[] = ud.elevationMaxHeights?.value ?? [];
    const elevationLogBoundaries: number[] =
      ud.elevationLogBoundaries?.value ?? [];
    const elevationRGBScalersAndBoundaries: Vector4[] =
      ud.elevationRGBScalersAndBoundaries?.value ?? [];
    const elevationDecoderOffsets: Vector4[] =
      ud.elevationDecoderOffsets?.value ?? [];
    const waterParams: Vector2[] = ud.waterParams?.value ?? [];
    const boundary = this.texturizedSceneIndexFrom;

    const layers: CompositeLayer[] = [];
    for (let absSlot = 0; absSlot < this.maxTextures; absSlot++) {
      const texture = textures[absSlot] ?? null;
      if (shows[absSlot] !== 1 || texture == null) continue;

      const region = absSlot < boundary ? "raster" : "vector";
      const uvOffset = layerUvOffset[absSlot] ?? new Vector2(0, 0);
      const uvScale = layerUvScale[absSlot] ?? new Vector2(1, 1);

      // Hillshade takes precedence: a slot flagged both ways has its color
      // zeroed and emits a normal, so classifying it as hillshade is correct —
      // the elevation sample would be zeroed anyway.
      if (isHillshades[absSlot]) {
        layers.push({
          kind: "hillshade",
          region,
          absSlot,
          texture,
          uvOffset,
          uvScale,
        });
      } else {
        // WebMercator-on-Geographic latitude reprojection, resolved by the
        // slot's drape resolver (always undefined on WM terrain).
        const slotReproject = (
          region === "vector" ? this.vectorDrape : this.rasterDrape
        ).slotReproject(absSlot);
        if (isElevationHeatmaps[absSlot]) {
          const usesBilinear = elevationHeatmapUsesBilinear[absSlot] ?? true;
          // Resolved per composite: atlas rows shift as colorMaps come and go.
          const colorRamp = this.ctx.colorMapAtlas?.getRow(
            elevationHeatmapLayerIds[absSlot],
          );
          const minHeight = elevationMinHeights[absSlot] ?? 0;
          const maxHeight = elevationMaxHeights[absSlot] ?? minHeight + 1;
          const logBoundary = elevationLogBoundaries[absSlot] ?? 0;
          const logarithmic = logBoundary > 0;

          layers.push({
            kind: "elevationHeatmap",
            region,
            absSlot,
            texture,
            uvOffset,
            uvScale,
            opacity: opacities[absSlot] ?? 1,
            reproject: slotReproject,
            filter: usesBilinear ? "linear" : "nearest",
            colorRamp,
            minHeight,
            maxHeight,
            logarithmic,
            logBoundary,
            rgbScalersAndBoundary: elevationRGBScalersAndBoundaries[absSlot],
            decoderOffsets: elevationDecoderOffsets[absSlot],
          });
        } else {
          layers.push({
            kind: "raster",
            region,
            absSlot,
            texture,
            uvOffset,
            uvScale,
            color: colors[absSlot] ?? new Color(),
            opacity: opacities[absSlot] ?? 1,
            water: (waterParams[absSlot]?.y ?? 0) > 0,
            reproject: slotReproject,
          });
        }
      }
    }

    const globals: CompositeGlobals = {
      watermask: this.userData.watermask?.texture ?? null,
      // Built lazily here, so a burst of colorMap changes rebuilds it once.
      colorMapTexture: this.ctx.colorMapAtlas?.getTexture() ?? null,
    };

    return { layers, globals };
  }

  async _init(mesh: MeshAdded) {
    // Registered first so a `createMesh` that throws still releases what the
    // constructor acquired.
    this.addEventListener("removedFromWorld", () => {
      this.dispose(
        this.ctx.tileMapByHandle,
        this.ctx.textureFragmentIndex,
        this.ctx.tileMeshToFragmentIds,
      );
    });

    await this.createMesh(
      generate_id_from_entity(mesh),
      mesh.mesh,
      mesh.material,
      mesh.transform,
      mesh.globe,
    );
  }

  private async createMesh(
    id: string,
    mesh: EventMesh,
    mat: RasterTileInternalMaterial,
    transform: Transform | undefined,
    globe: Globe,
  ) {
    const {
      scenes,
      meshes,
      loadedTexs,
      textureOptions,
      uniforms,
      textureFragmentIndex,
      tileMeshToFragmentIds,
    } = this.ctx;

    const boundingBox = this.installGeometry(mesh);
    if (!boundingBox) return;

    if (mat.showBoundingBox) {
      this.boundingBoxHelper = new Box3Helper(boundingBox, 0x00ff00);
      this.add(this.boundingBoxHelper);
    }

    this.material = this.initMaterial(mat, uniforms, globe);

    const maxTextures = this.maxTextures;
    this.setUniforms(mat, maxTextures);
    this.setupTextureFragments(
      mat.texture_fragments(),
      textureFragmentIndex,
      tileMeshToFragmentIds,
    );
    this.setupTextures(loadedTexs, textureOptions, maxTextures, mat);

    this.customDepthMaterial = terrainDepthMaterial(
      this.ctx.uniforms.terrainExaggeration,
    );
    this.castShadow = !!mat.castShadow;
    this.receiveShadow = !!mat.receiveShadow;
    applyLitOption(this.material, mat.lit);

    this.visible = false;
    this.renderOrder = mesh.render_order;
    if (transform) setTransform(this, transform);
    scenes.globe.add(this);
    meshes.set(id, this);
  }

  // Watermask: 1 byte = uniform, 65536 bytes = 256x256 grid. Stored for
  // downstream consumers (the composite pass); replaces any previous mask.
  private setWatermask(handle: number | undefined) {
    this.userData.watermask?.texture?.dispose();
    this.userData.watermask = undefined;
    if (handle == null) return;
    const watermask = this.ctx.buf.u8(handle);
    if (!watermask) return;

    const isUniform = watermask.length === 1;
    const size = isUniform ? 1 : 256;
    // Single-channel R8 — the composite shader only reads `.r`. RedFormat
    // halves GPU memory vs. RGBA (256×256 = 64KB instead of 256KB).
    // `watermask` is a short-lived view into WASM memory; copy it once and
    // share the copy between the texture and `data` (both only read it).
    const data = watermask.slice();
    const texture = new DataTexture(
      data,
      size,
      size,
      RedFormat,
      UnsignedByteType,
    );
    texture.flipY = true;
    // The composite's B-spline lookup weighs texels through the filter.
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    this.userData.watermask = {
      data,
      isUniform,
      texture,
    };
  }

  /**
   * Rebuild the geometry from new buffer handles under this same TileMesh.
   * Rust replaces an upsampled terrain mesh with its real-DEM mesh in place
   * (same entity, same tile handle) and reports it as `mesh_geometry_replaced`
   * rather than `mesh_updated`, so material, textures, atlas and drape state
   * are left alone; only geometry, shadow mesh, bounds and watermask change.
   * A changed watermask rebakes the atlas, and recompiles the program when it
   * appears or disappears.
   * Touching the material path here would blank the tile until its drape is
   * baked again.
   */
  replaceGeometry(mesh: EventMesh) {
    const outgoing = this.geometry;
    const hadNormalAttribute = !!this.userData.hasNormalAttribute;
    const hadWatermask = this.userData.watermask != null;

    if (!this.installGeometry(mesh)) return;

    outgoing.dispose();

    if (hadNormalAttribute !== this.userData.hasNormalAttribute) {
      // USE_VERTEX_NORMAL is compiled into the program: recompile it.
      this.material.userData.defines.USE_VERTEX_NORMAL = this.userData
        .hasNormalAttribute
        ? 1
        : 0;
      this.material.needsUpdate = true;
    }

    const hasWatermask = this.userData.watermask != null;
    if (hadWatermask !== hasWatermask) {
      // `hasWatermask` decides whether the water surface is compiled in.
      this.material.needsUpdate = true;
    }
    if (hadWatermask || hasWatermask) {
      this.compositor.markDirty(this.handle, "watermask");
    }
  }

  // Build the geometry from `mesh`'s buffer handles and make it this tile's
  // geometry, along with its bounds and watermask. Returns the bounding box, or
  // undefined when the buffers are gone.
  private installGeometry(mesh: EventMesh): Box3 | undefined {
    const { buf } = this.ctx;

    // Read the AABB before grabbing the buffer views below. `mesh.aabb` (and its
    // Vec3 center/extent) are wasm-bindgen getters that allocate WASM objects,
    // which can grow linear memory and detach any previously-obtained buffer
    // view. Reading it first keeps position/uv/indices/normals valid until
    // createSkirtMesh copies them.
    const aabb = mesh.aabb;
    const center = aabb.center;
    const extent = aabb.extent;
    const aabbCenter = new Vector3(center.x, center.y, center.z);
    const aabbExtent = new Vector3(extent.x, extent.y, extent.z);

    const position = buf.f32(mesh.vertices);
    const indices = buf.u32(mesh.indices);
    if (!position || !indices) return;

    const uv = buf.f32(mesh.uvs);
    const normals = mesh.normals != null ? buf.f32(mesh.normals) : null;
    // Absent for a flat tile, whose vertices all sit at height 0.
    const heights = mesh.heights != null ? buf.f32(mesh.heights) : null;

    // The buf.* arrays are short-lived views into WASM memory: they must be
    // consumed before any further WASM call that allocates. createSkirtMesh only
    // reads non-allocating handle getters and consecutive buf.* views, then
    // copies them once — into the combined buffers when a skirt exists, or via
    // slice() otherwise.
    this.terrainIndexCount = indices.length;
    const geometry = this.createSkirtMesh(
      mesh,
      position,
      uv,
      indices,
      normals,
      heights,
    );

    this.rawBounds = {
      center: aabbCenter,
      extent: aabbExtent,
      minHeight: mesh.min_height,
      maxHeight: mesh.max_height,
    };

    this.setWatermask(mesh.watermask);

    this.userData.hasNormalAttribute = normals != null;

    this.geometry = geometry;
    const boundingBox = this.applyExaggeratedBounds();

    // Drop the CPU-side typed arrays (position/uv/normal/index, and the skirt
    // data merged into the same combined buffers above) once the GPU upload
    // completes, so terrain geometry keeps a single resident (GPU) copy — the
    // premise behind GPU_GEOMETRY_RESIDENCY_FACTOR=1 in the Rust ledger.
    // Bounding volumes are already assigned from the WASM aabb above (no
    // computeBoundingBox re-read), nothing else re-reads these arrays, and
    // terrain geometry never goes through the worker `toBufferGeometryLike`
    // path, so releasing is safe. CONSTRAINT: once released these geometries
    // can no longer be re-uploaded on a WebGL context loss — acceptable because
    // terrain is re-fetched from Rust on demand, not restored from CPU memory.
    releaseGeometryArraysAfterUpload(geometry);

    return boundingBox;
  }

  /**
   * Rebuild the bounds for the current exaggeration. The GPU displaces the
   * vertices through the shared `uTerrainExaggeration` uniform, so only the
   * culling bounds need updating when it changes.
   */
  updateTerrainExaggeration() {
    this.applyExaggeratedBounds();
  }

  /** Re-read the vector drape sources Rust handed over for this tile on the
   * next render. */
  markVectorDrapeSourcesChanged() {
    this.vectorDrape.markSourcesChanged();
  }

  private applyExaggeratedBounds(): Box3 {
    const { center, extent, minHeight, maxHeight } = this.rawBounds;
    const { box, sphere } = exaggeratedTerrainBounds(
      center,
      extent,
      minHeight,
      maxHeight,
      this.ctx.uniforms.terrainExaggeration.value,
    );
    this.geometry.boundingBox = box;
    this.geometry.boundingSphere = sphere;
    if (this.boundingBoxHelper) {
      this.boundingBoxHelper.box = box;
    }
    return box;
  }

  // Create the geometry for rendering, with the terrain data at the front of
  // every buffer and the skirt, if any, behind it.
  // Normals are computed dynamically in the fragment shader from vPosition.
  createSkirtMesh(
    mesh: EventMesh,
    position: Float32Array,
    uv: Float32Array | null,
    indices: Uint32Array,
    normals: Float32Array | null,
    heights: Float32Array | null,
  ) {
    const { buf } = this.ctx;
    // Check for separate skirt data
    const skirtVerticesHandle = mesh.skirt_vertices;
    const skirtIndicesHandle = mesh.skirt_indices;
    const skirtUvsHandle = mesh.skirt_uvs;
    const skirtNormalsHandle = mesh.skirt_normals;
    const skirtHeightsHandle = mesh.skirt_heights;

    const hasSkirt = skirtVerticesHandle != null && skirtIndicesHandle != null;
    const skirtPosition =
      skirtVerticesHandle != null ? buf.f32(skirtVerticesHandle) : null;
    const skirtIndices =
      skirtIndicesHandle != null ? buf.u32(skirtIndicesHandle) : null;
    const skirtUv = skirtUvsHandle != null ? buf.f32(skirtUvsHandle) : null;
    const skirtNormals =
      skirtNormalsHandle != null ? buf.f32(skirtNormalsHandle) : null;
    const skirtHeights =
      skirtHeightsHandle != null ? buf.f32(skirtHeightsHandle) : null;
    const vertexCount = position.length / 3;

    const geometry = new BufferGeometry();
    if (hasSkirt && skirtPosition && skirtIndices) {
      // Combine vertices: terrain vertices + skirt vertices
      const combinedPosition = new Float32Array(
        position.length + skirtPosition.length,
      );
      combinedPosition.set(position);
      combinedPosition.set(skirtPosition, position.length);
      geometry.setAttribute(
        "position",
        new BufferAttribute(combinedPosition, 3),
      );

      // Combine UVs
      if (uv) {
        const combinedUv = new Float32Array(uv.length + (skirtUv?.length ?? 0));
        combinedUv.set(uv);
        if (skirtUv) {
          combinedUv.set(skirtUv, uv.length);
        }
        geometry.setAttribute("uv", new BufferAttribute(combinedUv, 2));
      }

      // Combine normals: terrain normals + skirt normals (computed in Rust as edge normals)
      if (normals) {
        const combinedNormals = new Float32Array(
          normals.length + (skirtNormals?.length ?? 0),
        );
        combinedNormals.set(normals);
        if (skirtNormals) {
          combinedNormals.set(skirtNormals, normals.length);
        }
        geometry.setAttribute(
          "normal",
          new BufferAttribute(combinedNormals, 3),
        );
      }

      // Combine heights: terrain heights + skirt heights. A flat tile's
      // terrain vertices stay zero.
      invariant(skirtHeights, "a terrain skirt carries its vertex heights");
      const combinedHeights = new Float32Array(
        vertexCount + skirtHeights.length,
      );
      if (heights) combinedHeights.set(heights);
      combinedHeights.set(skirtHeights, vertexCount);
      geometry.setAttribute(
        "terrainHeight",
        new BufferAttribute(combinedHeights, 1),
      );

      // Combine indices: terrain indices + skirt indices
      const combinedIndices = new Uint32Array(
        indices.length + skirtIndices.length,
      );
      combinedIndices.set(indices);
      combinedIndices.set(skirtIndices, indices.length);
      geometry.setIndex(new BufferAttribute(combinedIndices, 1));
    } else {
      // No skirt data - build the terrain geometry from the arrays. slice()
      // copies out of the WASM-memory views since BufferAttribute retains them.
      geometry.setAttribute(
        "position",
        new BufferAttribute(position.slice(), 3),
      );
      if (uv) {
        geometry.setAttribute("uv", new BufferAttribute(uv.slice(), 2));
      }
      if (normals) {
        geometry.setAttribute(
          "normal",
          new BufferAttribute(normals.slice(), 3),
        );
      }
      geometry.setAttribute(
        "terrainHeight",
        new BufferAttribute(
          heights ? heights.slice() : new Float32Array(vertexCount),
          1,
        ),
      );
      geometry.setIndex(new BufferAttribute(indices.slice(), 1));
    }

    return geometry;
  }

  private shouldUseNormal(
    mat: Partial<RasterTileInternalMaterial> | RasterTileInternalMaterial,
    globe: Globe,
  ): boolean {
    // Lambert (normal-based) shading is needed if any of these is true:
    // 1. globe.useNormal is set
    // 2. a per-vertex normal attribute is bound (e.g. quantized-mesh)
    // 3. any hillshade slot is active
    const hillshadeActive = !!mat.isHillshades?.some((v) => v !== 0);
    return (
      !!globe.useNormal || !!this.userData.hasNormalAttribute || hillshadeActive
    );
  }

  private initMaterial(
    _mat: RasterTileInternalMaterial,
    uniforms: CommonUniforms,
    globe: Globe,
  ): TileMaterial {
    const useNormal = this.shouldUseNormal(_mat, globe);
    const m = useNormal
      ? new MeshLambertMaterial({
          stencilWrite: false,
          color: globe.color,
        })
      : new MeshBasicMaterial({
          stencilWrite: false,
          color: globe.color,
        });

    m.userData.uPickable = {
      value: 0,
    };

    m.userData.fillQuadrants = { value: this.fillQuadrants };

    m.userData.defines = {
      USE_UV: 1,
      USE_SELECTIVE_EFFECT: 1,
      USE_VERTEX_NORMAL: this.userData.hasNormalAttribute ? 1 : 0,
    };

    m.envMap = uniforms.tSkyEnvMap.value ?? null;
    m.combine = AddOperation;

    const maxTextures = this.maxTextures;

    // Bind the compositor's atlas outputs as TileMesh-visible uniforms so the
    // slim shader can sample them.
    Object.assign(
      m.userData,
      atlasUniforms(this.compositor.acquireOutputs(this.handle)),
    );

    m.customProgramCacheKey = () =>
      `TILE${this.numTexturizedVector}${JSON.stringify(this.computeFeatures())}`;

    m.onBeforeCompile = (shader) => {
      shader.defines ??= {};
      Object.assign(shader.defines, m.userData.defines);
      shader.uniforms.reflectivity = { value: 0 };

      const features = this.computeFeatures();

      shader.uniforms.uPickable = m.userData.uPickable;
      shader.uniforms.uColorAtlas = m.userData.uColorAtlas;
      shader.uniforms.uAttrAtlas = m.userData.uAttrAtlas;
      shader.uniforms.uNormalAtlas = m.userData.uNormalAtlas;

      // Per-slot uniform arrays — indexed once per fragment by the winning
      // slot decoded from attr.a (no per-fragment loop any more).
      shader.uniforms.uColors = m.userData.colors;
      shader.uniforms.uReflectivities = m.userData.reflectivities;
      shader.uniforms.uRoughnesses = m.userData.roughnesses;
      shader.uniforms.uWaterParams = m.userData.waterParams;
      shader.uniforms.uWaterMaskColor = m.userData.waterMaskColor;
      shader.uniforms.uWaterMaskExaggeration = m.userData.waterMaskExaggeration;
      shader.uniforms.uShininesses = m.userData.shininesses;
      shader.uniforms.uSpecularStrengths = m.userData.specularStrengths;
      shader.uniforms.uSpeculars = m.userData.speculars;
      shader.uniforms.uEmissiveIntensities = m.userData.emissiveIntensities;
      shader.uniforms.uEmissiveColors = m.userData.emissiveColors;
      shader.uniforms.uEffectIdsMasks = m.userData.effectIdsMasks;
      // Satisfy MRT-injected single uniform declarations (tile uses per-slot
      // arrays + winIdx indexing instead).
      shader.uniforms.uEffectIdsMask = { value: 0 };
      shader.uniforms.uEmissiveIntensity = { value: 0 };
      const hasWaterSurface = features.hasWater || features.hasWatermask;
      if (useNormal && hasWaterSurface) {
        Object.assign(shader.uniforms, uniforms.water.uniforms, {
          nvrWaterWaves: m.userData.waterWaves,
        });
      }
      shader.uniforms.uHillshadeExaggeration = m.userData.hillshadeExaggeration;
      shader.uniforms.uIor = { value: 1.33333 };
      shader.uniforms.uFillQuadrants = m.userData.fillQuadrants;
      shader.uniforms.uTerrainExaggeration = uniforms.terrainExaggeration;

      shader.vertexShader = injectTerrainExaggeration(
        createReplacer(shader.vertexShader),
        true,
      )
        .replace(
          "#include <common>",
          `${TILE_VERTEX_INJECTIONS.afterCommon}
#include <common>`,
        )
        .replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>
          ${TILE_VERTEX_INJECTIONS.afterUvVertex}`,
        )
        .replace(
          "#include <envmap_vertex>",
          `#include <envmap_vertex>
          ${TILE_VERTEX_INJECTIONS.afterEnvmapVertex}`,
        ).source;

      shader.fragmentShader = createReplacer(shader.fragmentShader)
        .replace(
          "#include <common>",
          `
${generateTileCommonInjection(maxTextures)}

  #include <common>
  `,
        )
        .replaceWithCondition(
          "#include <lights_lambert_pars_fragment>",
          `
        #include <lights_lambert_pars_fragment>

        ${hasWaterSurface ? `${generateTileWaterDefines(features.hasWater, this.numTexturizedVector, this.texturizedSceneIndexFrom)}\n${WaterParsFragment}` : ""}
        ${SpecularParsFragment}
        ${BranchFreeTernary}
        `,
          useNormal,
        )
        .replace(
          "#include <map_fragment>",
          generateTileMapFragment(maxTextures),
        )
        .replaceWithCondition(
          "#include <normal_fragment_maps>",
          generateTileNormalFragmentMaps(features),
          useNormal,
        )
        .replaceWithCondition(
          "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;",
          `
          vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
          ${generateTileOutgoingLight(features)}
        `,
          useNormal,
        )
        .replaceWithCondition(
          "#include <envmap_fragment>",
          createReplacer(ShaderChunk.envmap_fragment).replace(
            "outgoingLight += envColor.xyz * specularStrength * reflectivity;",
            "outgoingLight += nvr_branchFreeTernary(useSpecular || tileWater, vec3(0.0), envColor.xyz * specularStrength * tileReflectivity);",
          ).source,
          useNormal,
        )
        // Pick override is the LAST write of the fragment shader (after
        // tonemapping/colorspace/fog/dithering), so the encoded batchId
        // reaches the pick buffer bit-for-bit. See TILE_PICK_FRAGMENT_OVERRIDE.
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
          ${TILE_PICK_FRAGMENT_OVERRIDE}`,
        )
        .replaceWithCondition(
          GBUFFER_NORMAL_WRITE_BASIC,
          generateTileNormalBufferReplacement(features),
          useNormal,
        )
        .replace(
          GBUFFER_EFFECT_WRITE_BUILTIN,
          TILE_EMISSIVE_EFFECT_BUFFER_REPLACEMENT,
        ).source;
    };

    this.ctx.viewContext?.applyShadowMaterial(m);

    return m;
  }

  /**
   * Restrict drawing to the given child quadrants (`Mesh::fill_quadrants`
   * bitmask, `0` = whole tile): a shown parent fills only the quadrants of
   * children that are not prepared yet, without overlapping the children on
   * screen. Kept on the instance so a material rebuild carries it over.
   */
  private setFillQuadrants(mask: number) {
    this.fillQuadrants = mask;
    const uniform = this.material?.userData.fillQuadrants;
    if (uniform) uniform.value = mask;
  }

  _update(mesh: MeshChanged) {
    const {
      loadedTexs,
      textureOptions,
      textureFragmentIndex,
      tileMeshToFragmentIds,
    } = this.ctx;
    const globe = mesh.globe;
    const changedMaterial = mesh.material;
    const tileMesh = mesh.mesh;
    const active = tileMesh.active;
    this.setFillQuadrants(tileMesh.fill_quadrants);

    const maxTextures = textureOptions.maxTextures;

    // TODO: Support hide entire globe.
    this.visible = active;

    if (active) {
      this.ensureCorrectMaterialType(changedMaterial, globe);

      this.setupTextureFragments(
        changedMaterial?.texture_fragments(),
        textureFragmentIndex,
        tileMeshToFragmentIds,
      );

      // Set uniforms (this may switch material type for hillshade)
      this.setUniforms(changedMaterial, maxTextures);

      this.setupTextures(
        loadedTexs,
        textureOptions,
        maxTextures,
        changedMaterial,
      );

      // Material / texture rebind → force the vector slots to re-bind their
      // per-slot uniform state on the next frame, and repaint the composite atlas.
      this.vectorDrape.invalidate();
      this.compositor.markDirty(this.handle, "material");
      this.compositor.markDirty(this.handle, "texture-binding");
    }

    // Update shadow settings
    if (this.castShadow !== changedMaterial.castShadow) {
      this.castShadow = !!changedMaterial.castShadow;
    }
    if (this.receiveShadow !== changedMaterial.receiveShadow) {
      this.receiveShadow = !!changedMaterial.receiveShadow;
    }
    applyLitOption(this.material, changedMaterial.lit);
    if (this.material.color.getHex() !== globe.color) {
      this.material.color.setHex(globe.color);
    }
    if (this.material.transparent !== globe.transparent) {
      this.material.transparent = globe.transparent;
      this.material.needsUpdate = true;
    }
    if (this.material.opacity !== globe.opacity) {
      this.material.opacity = globe.opacity;
    }
    if (this.material.wireframe !== globe.wireframe) {
      this.material.wireframe = globe.wireframe;
    }
  }

  /**
   * Ensures the material type matches the hillshade requirements.
   * Switches between MeshBasicMaterial and MeshLambertMaterial as needed.
   * - MeshLambertMaterial: Required for hillshade (supports normal-based lighting)
   * - MeshBasicMaterial: Used when no hillshade (more performant)
   */
  private ensureCorrectMaterialType(
    mat: RasterTileInternalMaterial,
    globe: Globe,
  ): void {
    // Same decision used by initMaterial — keeping them in sync avoids
    // mid-session Lambert↔Basic flips that strip normal shading from some tiles.
    const needsLambert = this.shouldUseNormal(mat, globe);
    const isLambert = this.material instanceof MeshLambertMaterial;

    if (needsLambert !== isLambert) {
      const oldMaterial = this.material;

      // Create new material with correct type. Per-layer UV uniforms will be
      // re-populated by setupTextures before the next render.
      this.material = this.initMaterial(mat, this.ctx.uniforms, globe);

      // Dispose old material
      this.ctx.viewContext?.removeShadowMaterial(oldMaterial);
      oldMaterial.dispose();
    }
  }

  private setUniforms(mat: RasterTileInternalMaterial, maxTextures: number) {
    const m = this.material;

    if (!m.userData.shows) {
      m.userData.shows = {
        value: [...new Array(maxTextures)].fill(0),
      };
    }
    if (!m.userData.colors) {
      m.userData.colors = {
        value: [...new Array(maxTextures)].map(() => new Color()),
      };
    }
    if (!m.userData.opacities) {
      m.userData.opacities = {
        value: [...new Array(maxTextures)].fill(1),
      };
    }
    if (!m.userData.reflectivities) {
      m.userData.reflectivities = {
        value: [...new Array(maxTextures)].fill(0),
      };
    }
    if (!m.userData.roughnesses) {
      m.userData.roughnesses = {
        value: [...new Array(maxTextures)].fill(GBUFFER_PHONG_ROUGHNESS),
      };
    }
    if (!m.userData.waterParams) {
      m.userData.waterParams = {
        value: [...new Array(maxTextures)].map(() => new Vector2()),
      };
    }
    // The watermask's and then one per vector slot, which `VectorDrapeResolver`
    // binds. The shader reads a slot's entry only when that slot is water.
    if (!m.userData.waterWaves) {
      const { waves } = this.waterMaskWaves();
      m.userData.waterWaves = {
        value: new Array(this.numTexturizedVector + 1).fill(waves),
      };
    }
    if (!m.userData.waterMaskColor) {
      m.userData.waterMaskColor = { value: new Vector4() };
    }
    if (!m.userData.waterMaskExaggeration) {
      m.userData.waterMaskExaggeration = { value: 1 };
    }
    if (!m.userData.shininesses) {
      m.userData.shininesses = {
        value: [...new Array(maxTextures)].fill(0),
      };
    }
    if (!m.userData.specularStrengths) {
      m.userData.specularStrengths = {
        value: [...new Array(maxTextures)].fill(0),
      };
    }
    if (!m.userData.speculars) {
      m.userData.speculars = {
        value: [...new Array(maxTextures)].fill(false),
      };
    }
    if (!m.userData.emissiveIntensities) {
      m.userData.emissiveIntensities = {
        value: [...new Array(maxTextures)].fill(0),
      };
    }
    if (!m.userData.emissiveColors) {
      m.userData.emissiveColors = {
        value: [...new Array(maxTextures)].map(() => new Color()),
      };
    }
    if (!m.userData.effectIdsMasks) {
      m.userData.effectIdsMasks = {
        value: [...new Array(maxTextures)].fill(0),
      };
    }

    // Elevation Heatmap uniforms
    if (!m.userData.isElevationHeatmaps) {
      m.userData.isElevationHeatmaps = {
        value: [...new Array(maxTextures)].fill(false),
      };
    }
    // Elevation Heatmap shader-side resampling (true = bilinear, false = nearest)
    if (!m.userData.elevationHeatmapUsesBilinear) {
      m.userData.elevationHeatmapUsesBilinear = {
        value: [...new Array(maxTextures)].fill(true),
      };
    }
    // Per-slot layer IDs for colorMap atlas row lookup at composite time
    if (!m.userData.elevationHeatmapLayerIds) {
      m.userData.elevationHeatmapLayerIds = {
        value: [...new Array(maxTextures)].fill(undefined),
      };
    }
    // Per-layer elevation min/max heights for normalization
    if (!m.userData.elevationMinHeights) {
      m.userData.elevationMinHeights = {
        value: [...new Array(maxTextures)].fill(0),
      };
    }
    if (!m.userData.elevationMaxHeights) {
      m.userData.elevationMaxHeights = {
        value: [...new Array(maxTextures)].fill(1),
      };
    }
    // Per-layer logarithmic scaling (0 = off, >0 = on with boundary value)
    if (!m.userData.elevationLogBoundaries) {
      m.userData.elevationLogBoundaries = {
        value: [...new Array(maxTextures)].fill(0),
      };
    }
    // Per-layer DEM decoder parameters
    if (!m.userData.elevationRGBScalersAndBoundaries) {
      m.userData.elevationRGBScalersAndBoundaries = {
        value: Array.from(
          { length: maxTextures },
          () => new Vector4(0, 0, 0, 0),
        ),
      };
    }
    if (!m.userData.elevationDecoderOffsets) {
      m.userData.elevationDecoderOffsets = {
        value: Array.from(
          { length: maxTextures },
          () => new Vector4(0, 0, 1, 0),
        ),
      };
    }

    // Hillshade uniforms
    if (!m.userData.isHillshades) {
      m.userData.isHillshades = {
        value: [...new Array(maxTextures)].fill(false),
      };
    }
    if (!m.userData.hillshadeOffset) {
      m.userData.hillshadeOffset = {
        value: 0.0,
      };
    }
    if (!m.userData.hillshadeExaggeration) {
      m.userData.hillshadeExaggeration = {
        value: 1.0,
      };
    }
    if (!m.userData.metersPerTexel) {
      m.userData.metersPerTexel = {
        value: [...new Array(maxTextures)].fill(1.0),
      };
    }

    // Reset all texture properties
    for (let i = 0; i < m.userData.shows.value.length; i++) {
      m.userData.shows.value[i] = 0;
      m.userData.colors.value[i] = new Color();
      m.userData.opacities.value[i] = 1;
      m.userData.isElevationHeatmaps.value[i] = false; // Reset elevation heatmap flags
      m.userData.elevationHeatmapUsesBilinear.value[i] = true;
      m.userData.elevationHeatmapLayerIds.value[i] = undefined; // Reset colorMap layer ID
      m.userData.isHillshades.value[i] = false; // Reset hillshade flags
    }

    // All properties have same length.
    const shows = mat.shows;
    const colors = mat.colors;
    const opacities = mat.opacities;
    for (let i = 0; i < shows.length; i++) {
      m.userData.shows.value[i] = shows[i];
      m.userData.colors.value[i] = new Color(colors[i]);
      m.userData.opacities.value[i] = opacities[i];
    }

    // Update elevation heatmap parameters from Rust material
    if (mat.isElevationHeatmaps && mat.isElevationHeatmaps.length > 0) {
      for (
        let i = 0;
        i < Math.min(mat.isElevationHeatmaps.length, maxTextures);
        i++
      ) {
        m.userData.isElevationHeatmaps.value[i] =
          mat.isElevationHeatmaps[i] !== 0;

        // Apply per-layer filter to elevation heatmap slots
        if (mat.isElevationHeatmaps[i] !== 0 && mat.elevationHeatmapFilters) {
          const filter = mat.elevationHeatmapFilters[i] || "linear";
          m.userData.elevationHeatmapUsesBilinear.value[i] =
            filter !== "nearest";
        }

        // Set per-layer min/max heights
        if (mat.elevationMinHeights) {
          m.userData.elevationMinHeights.value[i] =
            mat.elevationMinHeights[i] ?? 0;
        }
        if (mat.elevationMaxHeights) {
          const minH = m.userData.elevationMinHeights.value[i] ?? 0;
          m.userData.elevationMaxHeights.value[i] =
            mat.elevationMaxHeights[i] ?? minH + 1;
        }

        // Set per-layer logarithmic boundary (0 = off, >0 = on with boundary value).
        // The pseudo-log divides by ln(boundary), so it must be > 1; a missing
        // or smaller one falls back to the default instead of turning
        // logarithmic scaling off (or inverting / breaking the mapping).
        if (mat.logarithmics && mat.logBoundaries) {
          const logarithmic = (mat.logarithmics[i] ?? 0) !== 0;
          const boundary = mat.logBoundaries[i] ?? 0;
          m.userData.elevationLogBoundaries.value[i] = logarithmic
            ? boundary > 1
              ? boundary
              : DEFAULT_ELEVATION_HEATMAP_LOG_BOUNDARY
            : 0;
        }

        // Set per-layer DEM decoder parameters
        m.userData.elevationRGBScalersAndBoundaries.value[i].set(
          mat.elevationRScalers?.[i] ?? 0,
          mat.elevationGScalers?.[i] ?? 0,
          mat.elevationBScalers?.[i] ?? 0,
          mat.elevationBoundaries?.[i] ?? 0,
        );
        m.userData.elevationDecoderOffsets.value[i].set(
          mat.elevationMinOffsets?.[i] ?? 0,
          mat.elevationMaxOffsets?.[i] ?? 0,
          mat.elevationEpsilons?.[i] ?? 1,
          mat.elevationOffsets?.[i] ?? 0,
        );
      }
    }

    // Keep layer IDs; the colorMap atlas row is resolved at composite time
    if (mat.colorMapLayerIds && mat.colorMapLayerIds.length > 0) {
      for (
        let i = 0;
        i < Math.min(mat.colorMapLayerIds.length, maxTextures);
        i++
      ) {
        m.userData.elevationHeatmapLayerIds.value[i] =
          mat.colorMapLayerIds[i] || undefined;
      }
    }

    // Update hillshade parameters from Rust material
    if (mat.isHillshades && mat.isHillshades.length > 0) {
      for (let i = 0; i < Math.min(mat.isHillshades.length, maxTextures); i++) {
        m.userData.isHillshades.value[i] = mat.isHillshades[i] !== 0;
      }
    }

    // Hillshade exaggeration (applied during normal map sampling in shader)
    m.userData.hillshadeExaggeration.value = mat.hillshadeExaggeration;

    const waterMaskWaves = this.waterMaskWaves();
    waterMaskWaves.set({
      strength: mat.waveStrength,
      direction: mat.waveDirection,
      scale: "ocean",
      flowSpeed: mat.flowSpeed,
    });
    m.userData.waterWaves.value[0] = waterMaskWaves.waves;
    m.userData.waterMaskExaggeration.value = mat.waveExaggeration;

    // The terrain layer's body color for the watermask's water.
    const waterMaskColor: Vector4 = m.userData.waterMaskColor.value;
    if (mat.waterMaskColor === undefined) {
      waterMaskColor.w = 0;
    } else {
      const color = new Color().setHex(mat.waterMaskColor);
      waterMaskColor.set(color.r, color.g, color.b, 1);
    }

    const prevHillshade = m.userData.defines.USE_HILLSHADE;
    const newHillshade = m.userData.isHillshades.value.some(
      (v: boolean) => v === true,
    )
      ? 1
      : 0;
    m.userData.defines.USE_HILLSHADE = newHillshade;
    if (prevHillshade !== newHillshade) {
      this.material.needsUpdate = true;
    }
  }

  private setupTextureFragments(
    textureFragments: TextureFragment[] | undefined,
    textureFragmentIndex: Map<string, Set<TextureSlot>> | undefined,
    tileMeshToFragmentIds: Map<TileMesh, Set<string>> | undefined,
  ) {
    const m = this.material;

    // Per-layer parent fallback is now resolved in Rust: when a layer's own data
    // isn't ready, the entity slot in `texture_fragments` already points at the
    // nearest ready ancestor entity for that layer. So this side has nothing to do
    // for the "no fragments / use parent" case.
    if (!textureFragments || !textureFragments.length) {
      m.userData.textureFragments = { value: [] };
      updateTextureFragmentIndex(
        textureFragmentIndex,
        tileMeshToFragmentIds,
        this,
        [],
      );
      return;
    }

    const texturesFragmentIds = [];
    for (const fragment of textureFragments) {
      texturesFragmentIds.push(
        fragment ? generate_id_from_entity(fragment) : null,
      );
    }

    m.userData.textureFragments = {
      value: texturesFragmentIds,
    };

    // Update reverse index for efficient texture fragment lookups
    updateTextureFragmentIndex(
      textureFragmentIndex,
      tileMeshToFragmentIds,
      this,
      texturesFragmentIds,
    );
  }

  setupTextures(
    loadedTexes: Map<string, Texture>,
    textureOptions: TextureOptions,
    maxTextures: number,
    mat: Partial<RasterTileInternalMaterial> | RasterTileInternalMaterial,
    preserveLayerUv = false,
  ) {
    const m = this.material;

    if (!m.userData.textures) {
      m.userData.textures = {
        value: [...new Array(maxTextures)].fill(null),
      };
    }

    if (!m.userData.layerUvOffset) {
      m.userData.layerUvOffset = {
        value: [...new Array(maxTextures)].map(() => new Vector2(0, 0)),
      };
    }

    if (!m.userData.layerUvScale) {
      m.userData.layerUvScale = {
        value: [...new Array(maxTextures)].map(() => new Vector2(1, 1)),
      };
    }

    // Reset textures (always) and per-layer UV (only if not preserving)
    for (let i = 0; i < maxTextures; i++) {
      m.userData.textures.value[i] = null;

      // Skip resetting per-layer UV if preserving (e.g., during rebind)
      if (!preserveLayerUv) {
        m.userData.layerUvOffset.value[i].set(0, 0);
        m.userData.layerUvScale.value[i].set(1, 1);
      }
    }

    const textureFragments = m.userData.textureFragments?.value;
    const textureFragmentsLen = textureFragments?.length ?? 0;

    // Raster textures fill slots [0, texturizedSceneIndexFrom); texturized vector
    // scenes occupy the rest. Exactly `texturizedSceneIndexFrom` raster layers fit
    // (indices 0..from-1), so only a strictly larger count overflows. Each layer
    // costs one slot (a baked layer's overlap is mosaicked into a single render
    // target), so this guard is the final safety net for an oversized layer
    // count and the extra fragments are dropped below.
    if (textureFragmentsLen > this.texturizedSceneIndexFrom) {
      console.error(
        `Exceeded maximum textures: ${textureFragmentsLen} layers are provided. Maximum the number of textures is ${this.texturizedSceneIndexFrom}.`,
      );
    }

    const textures = m.userData.textures.value;

    // Per-layer UV transforms from Rust (covers regular textures and hillshades).
    // `null` entry means identity (no parent reuse).
    const layerUvTransforms = mat.layerUvTransforms?.() ?? [];

    // Per-slot Mercator reprojection (WebMercator raster on Geographic terrain).
    // Stashed for `buildCompositeLayers`; the terrain latitude range is shared by
    // every reprojecting slot of this tile.
    m.userData.layerReproject = Array.from(mat.layerReproject ?? []);
    m.userData.terrainLatRange = Array.from(mat.terrainLatRange ?? []);

    // Setting tile textures
    for (let i = 0; i < textureFragmentsLen; i++) {
      if (i >= this.texturizedSceneIndexFrom) {
        break;
      }

      const textureFragment = textureFragments[i];
      const t = textureFragment ? loadedTexes.get(textureFragment) : undefined;
      if (!t) {
        textures[i] = null;
        continue;
      }

      const isElevationHeatmap =
        mat.isElevationHeatmaps && mat.isElevationHeatmaps[i];
      const isHillshade = mat.isHillshades && mat.isHillshades[i];

      // Per-layer UV transform: identity by default; uses Rust's resolved transform
      // when this layer is sampling a parent tile.
      if (!preserveLayerUv) {
        const uvTransform = layerUvTransforms[i];
        if (uvTransform) {
          m.userData.layerUvOffset.value[i].set(
            uvTransform.offset.x,
            uvTransform.offset.y,
          );
          m.userData.layerUvScale.value[i].set(
            uvTransform.scale.x,
            uvTransform.scale.y,
          );
        } else {
          m.userData.layerUvOffset.value[i].set(0, 0);
          m.userData.layerUvScale.value[i].set(1, 1);
        }
      }

      const isDEMTexture = isElevationHeatmap || isHillshade;
      const targetColorSpace = isDEMTexture ? NoColorSpace : SRGBColorSpace;

      // Update colorSpace if needed
      const colorSpaceChanged = t.colorSpace !== targetColorSpace;
      if (colorSpaceChanged) {
        t.colorSpace = targetColorSpace;
        t.needsUpdate = true;
      }

      // CRITICAL: Elevation DEM textures must use NearestFilter to prevent interpolation artifacts.
      // Linear interpolation between ocean RGB(128,0,0) and land RGB(0,0,5)
      // produces intermediate values like RGB(64,0,2) which decode to ~42000m!
      // The elevation heatmap shader reads DEM texels with texelFetch and does its own
      // decode-then-interpolate for "linear" resampling, so the hardware filter
      // stays nearest regardless of the layer's resampling — this also matches
      // the raster bake (`configureRasterBakeSource`), so the two never fight
      // over the sampler and re-upload the texture.
      // Hillshade normal maps (which store normals directly in RGB, not encoded
      // heights) use LinearFilter for smooth bilinear interpolation at tile boundaries.
      if (isDEMTexture) {
        const targetFilter = isHillshade ? LinearFilter : NearestFilter;
        if (t.minFilter !== targetFilter) {
          t.minFilter = targetFilter;
          t.needsUpdate = true;
        }
        if (t.magFilter !== targetFilter) {
          t.magFilter = targetFilter;
          t.needsUpdate = true;
        }

        if (t.generateMipmaps !== false) {
          t.generateMipmaps = false;
          t.needsUpdate = true;
        }
      } else {
        // Regular textures: only update sampler settings when first binding
        if (t.minFilter !== textureOptions.minFilter) {
          t.minFilter = textureOptions.minFilter as MinificationTextureFilter;
          t.needsUpdate = true;
        }
        if (t.magFilter !== textureOptions.magFilter) {
          t.magFilter = textureOptions.magFilter as MagnificationTextureFilter;
          t.needsUpdate = true;
        }
        if (t.anisotropy !== textureOptions.maxAnisotropy) {
          t.anisotropy = textureOptions.maxAnisotropy;
          t.needsUpdate = true;
        }
        if (t.generateMipmaps !== textureOptions.useMipmaps) {
          t.generateMipmaps = textureOptions.useMipmaps;
          t.needsUpdate = true;
        }
      }

      textures[i] = t;
    }

    // Re-derive each drape resolver's slot pairing / bindings from the rebuilt
    // material (the raster call is a no-op on WebMercator terrain, where every
    // raster slot carries its own fragment and drapes directly).
    this.rasterDrape.syncMaterialSlots(textureFragments);
    this.vectorDrape.syncMaterialSlots();
  }

  /**
   * Rebind textures for this TileMesh by calling setupTextures
   * This ensures texture updates go through the standard texture management system
   * Used by hillshade backfill and other dynamic texture updates.
   * Preserves existing per-layer UV transforms to avoid overwriting parent-reuse values.
   */
  rebindTextures(
    loadedTexs: Map<string, Texture>,
    textureOptions: TextureOptions,
  ) {
    const material = this.material;
    if (!material || !material.userData) return;

    // Create a minimal material object with the required fields from current material
    const materialData: Partial<RasterTileInternalMaterial> = {
      isElevationHeatmaps: material.userData.isElevationHeatmaps?.value,
      isHillshades: material.userData.isHillshades?.value,
    };

    this.setupTextures(
      loadedTexs,
      textureOptions,
      this.maxTextures,
      materialData,
      true, // preserveLayerUv
    );
    // Hillshade backfill / dynamic rebinds change the composite atlas inputs.
    this.compositor.markDirty(this.handle, "hillshade");
  }

  onBeforePicking(): void {
    this.material.userData.uPickable.value = 1;

    // Re-bake the vector scenes with pick-id colors (hard-edged, no MSAA).
    this.vectorDrape.setPickBake(true);
    this.compositor.markDirty(this.handle, "vector-revision");
  }

  onAfterPicking(): void {
    this.material.userData.uPickable.value = 0;
    this.vectorDrape.setPickBake(false);
    this.compositor.markDirty(this.handle, "vector-revision");
  }

  getRenderable(): Object3D {
    return this;
  }

  private _disposed = false;

  dispose(
    tileMapByHandle?: TileMapByHandle,
    textureFragmentIndex?: Map<string, Set<TextureSlot>>,
    tileMeshToFragmentIds?: Map<TileMesh, Set<string>>,
  ) {
    // A second dispose would steal another holder's compositor refcount.
    if (this._disposed) {
      if (import.meta.env?.DEV) {
        console.error(
          `TileMesh.dispose called twice for handle ${this.handle}`,
        );
      }
      return;
    }
    this._disposed = true;

    // Remove from texture fragment index
    if (textureFragmentIndex && tileMeshToFragmentIds) {
      removeTextureFragmentIndex(
        textureFragmentIndex,
        tileMeshToFragmentIds,
        this,
      );
    }

    this.ctx.viewContext?.removeShadowMaterial(this.material);

    // Note: geometry disposal is handled by disposeObject3D() in event/index.ts
    // before removedFromWorld is dispatched.

    // Dispose the drape resolvers' WebGLRenderTargets to free GPU memory
    this.vectorDrape.dispose();
    this.rasterDrape.dispose();
    // Do NOT report a zero drape cost here. The Rust `TerrainTileGpuCost` /
    // `TileCost` live on the mesh entity, whose despawn already subtracts the
    // full cost from the ledger via the component `on_replace` hook — so the
    // report is redundant on the normal removal path. Worse, on the terrain
    // mesh-replacement path the old entity is marked `Deleted` while a NEW live
    // mesh reuses the same position-stable handle, so `reportDrapeGpuBytes(0)`
    // would resolve (via `Without<Deleted>`) to the NEW entity and wipe the
    // atlas cost the incoming mesh reported. Leaving accounting to
    // the entity despawn keeps both paths correct.
    this.reportedDrapeGpuBytes = 0;

    // Release the watermask DataTexture (one per tile, RedFormat 1×1 or 256×256).
    this.userData.watermask?.texture?.dispose();
    this._waterMaskWaves?.dispose();

    // Clean up from tileMapByHandle, unless an incoming mesh replacing this
    // one has already claimed the handle (see `reportDrapeGpuBytesIfChanged`).
    if (tileMapByHandle?.get(this.handle) === this) {
      tileMapByHandle.delete(this.handle);
    }

    // Release the per-tile composite atlas (refcounted via the compositor's
    // TileTextureCache). Mirrors the acquire() in the constructor.
    this.compositor.release(this.handle);

    // Note: the texturized-scene cache is keyed by WM vector tile handle and is
    // shared across terrain tiles (N:M draping), so it is NOT deleted here — its
    // entries are cleared by the vector unload path in event/feature.ts.
  }
}
