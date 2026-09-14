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
import WaterParsFragment from "@shaders/glsl/chunks/water_pars_fragment.glsl?raw";
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
  Sphere,
  NoColorSpace,
  MeshBasicMaterial,
  LinearFilter,
} from "three";

import { setTransform } from "../../event";
import type { EventContext, TileHandler } from "../../event/context";
import {
  GBUFFER_EFFECT_WRITE_BUILTIN,
  GBUFFER_NORMAL_WRITE_BASIC,
  generateTileCommonInjection,
  generateTileMapFragment,
  generateTileNormalFragmentMaps,
  TILE_EMISSIVE_EFFECT_BUFFER_REPLACEMENT,
  TILE_NORMAL_BUFFER_REPLACEMENT,
  TILE_PICK_FRAGMENT_OVERRIDE,
  TILE_VERTEX_INJECTIONS,
  applyLitOption,
} from "../../material";
import { deriveCompositeFeatures } from "../../material/enhancer/tileComposite";
import type { CustomObject3DEventMap } from "../../object3DEvent";
import type { TextureOptions } from "../../textures";
import {
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
import type { PickableMesh } from "../pickableMesh";
import { releaseGeometryArraysAfterUpload } from "../releaseGeometryArrays";

import type { DrapeResolver } from "./drapeResolver";
import {
  BakedRasterDrapeResolver,
  DirectRasterDrapeResolver,
} from "./rasterDrapeResolver";
import { VectorDrapeResolver } from "./vectorDrapeResolver";

export type TileMaterial = MeshBasicMaterial | MeshLambertMaterial;

/** The MRT composite atlas has three RGBA attachments (color, attr, normal). */
const ATLAS_ATTACHMENTS = 3;
/** GPU bytes for one drape render target at side length `size`: size² RGBA. */
function drapeRtBytes(size: number): number {
  return size * size * 4;
}
/** GPU bytes for the per-tile composite atlas at side length `size`: one MRT
 * with three size² RGBA attachments. A terrain tile acquires this atlas in its
 * constructor and holds it for its whole lifetime (raster-only tiles
 * included), so Rust seeds it into the tile's cost at mesh-attach time and
 * every drape report from here must keep including it. The side length is 512²
 * on both desktop and mobile (so ~3MB per tile with three attachments) and
 * flows in from the compositor, which is the SAME source of truth
 * `getDefaultMemoryCostHints` feeds to the Rust ledger — so the reported bytes
 * always match the seed. */
function compositeAtlasBytes(size: number): number {
  return size * size * 4 * ATLAS_ATTACHMENTS;
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

  // Separate mesh for shadow casting (uses terrain-only geometry without skirt)
  private shadowMesh?: Mesh<BufferGeometry, TileMaterial>;

  private compositor: TileTextureCompositor;

  // Drape RT side length + atlas byte cost, read from the compositor (the
  // single source of truth shared with the Rust cost hints) in the constructor.
  // Per-instance rather than module constants because the compositor size is a
  // runtime value (512² on both desktop and mobile today, but configurable).
  private readonly drapeRtSize: number;
  private readonly atlasBytes: number;
  // Drape footprint (bytes) last reported to the memory ledger, so a report
  // only crosses the WASM boundary when it actually changes. Starts at the
  // atlas cost to match the seed Rust charges at mesh-attach time (the atlas
  // is acquired in the constructor) — a tile that never drapes therefore
  // never reports. Assigned in the constructor once `atlasBytes` is known.
  private reportedDrapeGpuBytes: number;

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
    this.atlasBytes = compositeAtlasBytes(this.compositor.size);
    this.reportedDrapeGpuBytes = this.atlasBytes;

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
    if (additionalTexturesInUse.waterTexture) numAdditionalTextures++;
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

    this.onBeforeRender = this._onBeforeRender;
  }

  /**
   * Report the tile's drape GPU footprint (composite atlas + vector and baked-raster
   * drape render targets) to the memory ledger when it changed. The atlas is acquired
   * in the constructor and held for the tile's lifetime regardless of draping, so it
   * is always part of the report — otherwise a tile whose last draped layer vanished
   * would report 0 and wipe the atlas cost Rust seeds at mesh-attach time. The render
   * targets on top of it scale with terrain subdivision past the layers' maxZoom — a
   * cost per-source-tile accounting cannot see.
   */
  private reportDrapeGpuBytesIfChanged() {
    const rtCount =
      this.vectorDrape.liveRenderTargetCount() +
      this.rasterDrape.liveRenderTargetCount();
    const bytes = this.atlasBytes + rtCount * drapeRtBytes(this.drapeRtSize);
    if (bytes === this.reportedDrapeGpuBytes) return;
    // Only the mesh currently registered for this position-stable handle may
    // report. During a terrain mesh replacement the outgoing mesh briefly
    // coexists with the incoming one, which has already claimed the handle
    // (constructor's `tileMapByHandle.set`) and been seeded by
    // `attach_terrain_mesh_cost`. A stray report from the outgoing mesh would
    // resolve on the Rust side (via `Without<Deleted>`) to the NEW live entity
    // and overwrite its freshly-seeded atlas cost — the same hazard the
    // dispose() 0-report guards against, here on the non-zero path.
    if (this.ctx.tileMapByHandle.get(this.handle) !== this) return;
    this.reportedDrapeGpuBytes = bytes;
    this.tileHandler.reportDrapeGpuBytes(this.handle, bytes);
  }

  private _onBeforeRender = () => {
    if (!this.visible) return;

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
    this.compositor.runCompositePassIfDirty(
      this.handle,
      plan,
      globals,
      deriveCompositeFeatures(layers, globals),
    );
  };

  /**
   * Feature flags for the **main** TileMesh shader (atlas-sampling side): drives
   * its program cache key and which normal/specular branches compile. Sourced
   * from the material defines/userData, independent of the composite pass's own
   * (layer-derived) feature set — see {@link deriveCompositeFeatures}.
   */
  private computeFeatures(): CompositeFeatures {
    const ud = this.material.userData;
    // Only slots that are still shown count: bindVectorSlots sets shows=0 when a
    // slot loses its representative mesh but leaves the per-slot waters/heatmap
    // uniforms at their previous values, so a disappeared layer would otherwise
    // keep its shader feature (e.g. water) compiled in. Mirrors the shows gate in
    // buildCompositeLayers.
    const shows: number[] = ud.shows?.value ?? [];
    const waters = ud.waters?.value as boolean[] | undefined;
    const heatmaps = ud.isElevationHeatmaps?.value as boolean[] | undefined;
    return {
      hasHillshade: ud.defines?.USE_HILLSHADE === 1,
      hasWater: !!waters?.some((v, i) => v === true && shows[i] === 1),
      hasElevationHeatmap: !!heatmaps?.some(
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
    const waters: boolean[] = ud.waters?.value ?? [];
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
          layers.push({
            kind: "elevationHeatmap",
            region,
            absSlot,
            texture,
            uvOffset,
            uvScale,
            opacity: opacities[absSlot] ?? 1,
            reproject: slotReproject,
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
            water: waters[absSlot] ?? false,
            reproject: slotReproject,
          });
        }
      }
    }

    const globals: CompositeGlobals = {
      hillshadeExaggeration: ud.hillshadeExaggeration?.value ?? 1,
      watermask: this.userData.watermask?.texture ?? null,
      colorMapTexture: this.ctx.uniforms.colorMapTexture.value ?? null,
      elevationRGBScaler: ud.elevationRGBScaler?.value ?? new Vector3(),
      elevationMinMaxHeightAndBoundary:
        ud.elevationMinMaxHeightAndBoundary?.value ?? new Vector3(),
      elevationMinMaxOffsetAndEpsilonAndOffset:
        ud.elevationMinMaxOffsetAndEpsilonAndOffset?.value ?? new Vector4(),
      logarithmic: ud.logarithmic?.value ?? false,
      logBase: ud.logBase?.value ?? 10,
      logBoundary: ud.logBoundary?.value ?? 10,
    };

    return { layers, globals };
  }

  async _init(mesh: MeshAdded) {
    await this.createMesh(
      generate_id_from_entity(mesh),
      mesh.mesh,
      mesh.material,
      mesh.transform,
      mesh.globe,
    );

    this.addEventListener("removedFromWorld", () => {
      this.dispose(
        this.ctx.tileMapByHandle,
        this.ctx.textureFragmentIndex,
        this.ctx.tileMeshToFragmentIds,
      );
    });
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
      buf,
      loadedTexs,
      textureOptions,
      uniforms,
      textureFragmentIndex,
      tileMeshToFragmentIds,
    } = this.ctx;

    // Read the AABB before grabbing the buffer views below. `mesh.aabb` (and its
    // Vec3 center/extent) are wasm-bindgen getters that allocate WASM objects,
    // which can grow linear memory and detach any previously-obtained buffer
    // view. Reading it first keeps position/uv/indices/normals valid until
    // createSkirtMesh copies them.
    const aabb = mesh.aabb;
    const center = aabb.center;
    const extent = aabb.extent;
    const aabb_center = new Vector3(center.x, center.y, center.z);
    const aabb_extent = new Vector3(extent.x, extent.y, extent.z);

    const position = buf.f32(mesh.vertices);
    const indices = buf.u32(mesh.indices);
    if (!position || !indices) return;

    const uv = buf.f32(mesh.uvs);
    const normals = mesh.normals != null ? buf.f32(mesh.normals) : null;

    // The buf.* arrays are short-lived views into WASM memory: they must be
    // consumed before any further WASM call that allocates. createSkirtMesh only
    // reads non-allocating handle getters and consecutive buf.* views, then
    // copies them once — into the combined buffers when a skirt exists, or via
    // slice() otherwise.
    // Terrain-only geometry (for shadow rendering). createSkirtMesh fills it:
    // when a skirt exists it shares the combined geometry's buffers (with the
    // skirt cut off via drawRange).
    const terrainGeometry = new BufferGeometry();

    const geometry = this.createSkirtMesh(
      mesh,
      terrainGeometry,
      position,
      uv,
      indices,
      normals,
    );

    // Watermask: 1 byte = uniform, 65536 bytes = 256x256 grid. Stored for downstream consumers.
    if (mesh.watermask != null) {
      const watermask = buf.u8(mesh.watermask);
      if (watermask) {
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
        texture.needsUpdate = true;
        this.userData.watermask = {
          data,
          isUniform,
          texture,
        };
      }
    }

    this.userData.hasNormalAttribute = normals != null;

    geometry.boundingBox = new Box3(
      aabb_center.clone().sub(aabb_extent),
      aabb_center.clone().add(aabb_extent),
    );

    geometry.boundingSphere = new Sphere(aabb_center, aabb_extent.length());

    if (mat.showBoundingBox) {
      const bb = new Box3Helper(geometry.boundingBox, 0x00ff00);
      this.add(bb);
    }
    this.geometry = geometry;

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
    // When a skirt exists, `terrainGeometry` (shadow mesh) shares these exact
    // BufferAttribute instances, so this one call releases both meshes' arrays.
    releaseGeometryArraysAfterUpload(geometry);

    this.material = this.initMaterial(mat, uniforms, globe);

    const maxTextures = this.maxTextures;
    this.setUniforms(mat, maxTextures);
    this.setupTextureFragments(
      mat.texture_fragments(),
      textureFragmentIndex,
      tileMeshToFragmentIds,
    );
    this.setupTextures(loadedTexs, textureOptions, maxTextures, mat);

    // Create shadow mesh if we have separate terrain geometry (i.e., skirt exists)
    // This prevents the skirt from casting unexpected shadows
    if (geometry !== terrainGeometry) {
      terrainGeometry.boundingBox = geometry.boundingBox.clone();
      terrainGeometry.boundingSphere = geometry.boundingSphere.clone();

      // Create shadow mesh using terrain-only geometry (without skirt)
      this.shadowMesh = new Mesh(terrainGeometry, this.material);
      this.shadowMesh.castShadow = !!mat.castShadow;
      this.shadowMesh.receiveShadow = !!mat.receiveShadow;
      this.add(this.shadowMesh);

      // Main mesh with skirt doesn't cast shadow, but receives it
      this.castShadow = false;
      this.receiveShadow = !!mat.receiveShadow;
    } else {
      // No skirt - use the main mesh for both rendering and shadow
      this.castShadow = !!mat.castShadow;
      this.receiveShadow = !!mat.receiveShadow;
    }
    applyLitOption(this.material, mat.lit);

    this.visible = false;
    this.renderOrder = mesh.render_order;
    if (transform) setTransform(this, transform);
    scenes.globe.add(this);
    meshes.set(id, this);
  }

  // Create combined geometry (terrain + skirt) for rendering, and populate
  // `terrainGeometry` (used by shadowMesh so the skirt casts no shadow) with
  // the same buffers, restricted to the terrain via drawRange.
  // Normals are computed dynamically in the fragment shader from vPosition.
  createSkirtMesh(
    mesh: EventMesh,
    terrainGeometry: BufferGeometry,
    position: Float32Array,
    uv: Float32Array | null,
    indices: Uint32Array,
    normals: Float32Array | null,
  ) {
    const { buf } = this.ctx;
    // Check for separate skirt data
    const skirtVerticesHandle = mesh.skirt_vertices;
    const skirtIndicesHandle = mesh.skirt_indices;
    const skirtUvsHandle = mesh.skirt_uvs;
    const skirtNormalsHandle = mesh.skirt_normals;

    const hasSkirt = skirtVerticesHandle != null && skirtIndicesHandle != null;
    const skirtPosition =
      skirtVerticesHandle != null ? buf.f32(skirtVerticesHandle) : null;
    const skirtIndices =
      skirtIndicesHandle != null ? buf.u32(skirtIndicesHandle) : null;
    const skirtUv = skirtUvsHandle != null ? buf.f32(skirtUvsHandle) : null;
    const skirtNormals =
      skirtNormalsHandle != null ? buf.f32(skirtNormalsHandle) : null;

    // Create combined geometry (terrain + skirt) for main rendering
    let geometry: BufferGeometry;
    if (hasSkirt && skirtPosition && skirtIndices) {
      geometry = new BufferGeometry();

      // The terrain data sits at the front of every combined buffer, so the
      // terrain-only (shadow) geometry shares the combined attributes — one
      // CPU array and one GPU buffer per attribute — and drawRange below cuts
      // the skirt off.

      // Combine vertices: terrain vertices + skirt vertices
      const combinedPosition = new Float32Array(
        position.length + skirtPosition.length,
      );
      combinedPosition.set(position);
      combinedPosition.set(skirtPosition, position.length);
      const positionAttribute = new BufferAttribute(combinedPosition, 3);
      geometry.setAttribute("position", positionAttribute);
      terrainGeometry.setAttribute("position", positionAttribute);

      // Combine UVs
      if (uv) {
        const combinedUv = new Float32Array(uv.length + (skirtUv?.length ?? 0));
        combinedUv.set(uv);
        if (skirtUv) {
          combinedUv.set(skirtUv, uv.length);
        }
        const uvAttribute = new BufferAttribute(combinedUv, 2);
        geometry.setAttribute("uv", uvAttribute);
        terrainGeometry.setAttribute("uv", uvAttribute);
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
        const normalAttribute = new BufferAttribute(combinedNormals, 3);
        geometry.setAttribute("normal", normalAttribute);
        terrainGeometry.setAttribute("normal", normalAttribute);
      }

      // Combine indices: terrain indices + skirt indices
      const combinedIndices = new Uint32Array(
        indices.length + skirtIndices.length,
      );
      combinedIndices.set(indices);
      combinedIndices.set(skirtIndices, indices.length);
      const indexAttribute = new BufferAttribute(combinedIndices, 1);
      geometry.setIndex(indexAttribute);

      terrainGeometry.setIndex(indexAttribute);
      terrainGeometry.setDrawRange(0, indices.length);
    } else {
      // No skirt data - build the terrain geometry from the arrays. slice()
      // copies out of the WASM-memory views since BufferAttribute retains them.
      terrainGeometry.setAttribute(
        "position",
        new BufferAttribute(position.slice(), 3),
      );
      if (uv) {
        terrainGeometry.setAttribute("uv", new BufferAttribute(uv.slice(), 2));
      }
      if (normals) {
        terrainGeometry.setAttribute(
          "normal",
          new BufferAttribute(normals.slice(), 3),
        );
      }
      terrainGeometry.setIndex(new BufferAttribute(indices.slice(), 1));
      geometry = terrainGeometry;
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

    m.userData.uTime = uniforms.time;

    m.userData.defines = {
      USE_UV: 1,
      USE_SELECTIVE_EFFECT: 1,
      USE_VERTEX_NORMAL: this.userData.hasNormalAttribute ? 1 : 0,
    };

    m.envMap = uniforms.tSkyEnvMap.value ?? null;
    m.combine = AddOperation;

    const maxTextures = this.maxTextures;

    // Bind the compositor's atlas outputs as TileMesh-visible uniforms so the
    // slim shader can sample them. Atlas Textures are created once per tile
    // and persist across composite passes — `needsUpdate` is flipped by the
    // compositor when a new pass writes to them.
    const atlasOutputs = this.compositor.acquireOutputs(this.handle);
    m.userData.uColorAtlas = { value: atlasOutputs.color };
    m.userData.uAttrAtlas = { value: atlasOutputs.attr };
    m.userData.uNormalAtlas = { value: atlasOutputs.normal };

    m.customProgramCacheKey = () =>
      "TILE" + JSON.stringify(this.computeFeatures());

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
      shader.uniforms.uWaterScaleNormals = m.userData.waterScaleNormals;
      shader.uniforms.uWaterSpeeds = m.userData.waterSpeeds;
      shader.uniforms.uShininesses = m.userData.shininesses;
      shader.uniforms.uSpecularStrengths = m.userData.specularStrengths;
      shader.uniforms.uApplyWaterNormals = m.userData.applyWaterNormals;
      shader.uniforms.uSpeculars = m.userData.speculars;
      shader.uniforms.uEmissiveIntensities = m.userData.emissiveIntensities;
      shader.uniforms.uEmissiveColors = m.userData.emissiveColors;
      shader.uniforms.uEffectIdsMasks = m.userData.effectIdsMasks;
      // Satisfy MRT-injected single uniform declarations (tile uses per-slot
      // arrays + winIdx indexing instead).
      shader.uniforms.uEffectIdsMask = { value: 0 };
      shader.uniforms.uEmissiveIntensity = { value: 0 };
      shader.uniforms.uWaterNormalMap = uniforms.waterTexture;
      shader.uniforms.uHillshadeExaggeration = m.userData.hillshadeExaggeration;
      shader.uniforms.uIor = { value: 1.33333 };
      shader.uniforms.uTime = m.userData.uTime;

      shader.vertexShader = createReplacer(shader.vertexShader)
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

        ${WaterParsFragment}
        ${SpecularParsFragment}
        ${BranchFreeTernary}
        `,
          useNormal,
        )
        .replace(
          "#include <map_fragment>",
          generateTileMapFragment(maxTextures, features),
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
          outgoingLight += specular;
        `,
          useNormal,
        )
        .replaceWithCondition(
          "#include <envmap_fragment>",
          createReplacer(ShaderChunk.envmap_fragment).replace(
            "outgoingLight += envColor.xyz * specularStrength * reflectivity;",
            "outgoingLight += nvr_branchFreeTernary(useSpecular, vec3(0.0), envColor.xyz * specularStrength * tileReflectivity);",
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
          TILE_NORMAL_BUFFER_REPLACEMENT,
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
    // If shadowMesh exists, it handles castShadow while main mesh only receives shadows
    if (this.shadowMesh) {
      if (this.shadowMesh.castShadow !== changedMaterial.castShadow) {
        this.shadowMesh.castShadow = !!changedMaterial.castShadow;
      }
      if (this.shadowMesh.receiveShadow !== changedMaterial.receiveShadow) {
        this.shadowMesh.receiveShadow = !!changedMaterial.receiveShadow;
      }
      // Main mesh with skirt never casts shadow
      this.castShadow = false;
    } else {
      if (this.castShadow !== changedMaterial.castShadow) {
        this.castShadow = !!changedMaterial.castShadow;
      }
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

      if (this.shadowMesh) {
        this.shadowMesh.material = this.material;
      }

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
        value: [...new Array(maxTextures)].fill(0),
      };
    }
    if (!m.userData.waters) {
      m.userData.waters = {
        value: [...new Array(maxTextures)].fill(false),
      };
    }
    if (!m.userData.waterScaleNormals) {
      m.userData.waterScaleNormals = {
        value: [...new Array(maxTextures)].fill(0),
      };
    }
    if (!m.userData.waterSpeeds) {
      m.userData.waterSpeeds = {
        value: [...new Array(maxTextures)].fill(0),
      };
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
    if (!m.userData.applyWaterNormals) {
      m.userData.applyWaterNormals = {
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
    if (!m.userData.elevationRGBScaler) {
      m.userData.elevationRGBScaler = {
        value: new Vector3(0, 0, 0),
      };
    }
    if (!m.userData.elevationMinMaxHeightAndBoundary) {
      m.userData.elevationMinMaxHeightAndBoundary = {
        value: new Vector3(0, 0, 0), // minHeight, maxHeight, boundary
      };
    }
    if (!m.userData.elevationMinMaxOffsetAndEpsilonAndOffset) {
      m.userData.elevationMinMaxOffsetAndEpsilonAndOffset = {
        value: new Vector4(0, 0, 0, 0), // minOffset, maxOffset, epsilon, offset
      };
    }
    if (!m.userData.logarithmic) {
      m.userData.logarithmic = {
        value: false,
      };
    }
    if (!m.userData.logBase) {
      m.userData.logBase = {
        value: 10,
      };
    }
    if (!m.userData.logBoundary) {
      m.userData.logBoundary = {
        value: 10,
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

    m.userData.elevationRGBScaler.value.set(
      mat.elevationRScaler,
      mat.elevationGScaler,
      mat.elevationBScaler,
    );

    m.userData.elevationMinMaxHeightAndBoundary.value.set(
      mat.elevationMinHeight,
      mat.elevationMaxHeight,
      mat.elevationBoundary,
    );

    m.userData.elevationMinMaxOffsetAndEpsilonAndOffset.value.set(
      mat.elevationMinOffset,
      mat.elevationMaxOffset,
      mat.elevationEpsilon,
      mat.elevationOffset,
    );

    m.userData.logarithmic.value = mat.logarithmic;
    m.userData.logBase.value = Math.log(mat.logBoundary);
    m.userData.logBoundary.value = mat.logBoundary;

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
      // However, hillshade normal maps (which store normals directly in RGB, not encoded heights)
      // should use LinearFilter for smooth bilinear interpolation at tile boundaries.
      // Always apply these settings for DEM textures, independent of colorSpace change
      if (isDEMTexture) {
        if (isHillshade) {
          // Hillshade normal maps: use LinearFilter for hardware bilinear interpolation
          // Normals are stored directly in RGB [-1,1] -> [0,1], so linear filtering is safe
          if (t.minFilter !== LinearFilter) {
            t.minFilter = LinearFilter;
            t.needsUpdate = true;
          }
          if (t.magFilter !== LinearFilter) {
            t.magFilter = LinearFilter;
            t.needsUpdate = true;
          }
        }

        if (isElevationHeatmap) {
          // Elevation DEM textures: use NearestFilter to prevent decoding artifacts
          // RGB-encoded heights must not be interpolated before decoding
          if (t.minFilter !== NearestFilter) {
            t.minFilter = NearestFilter;
            t.needsUpdate = true;
          }
          if (t.magFilter !== NearestFilter) {
            t.magFilter = NearestFilter;
            t.needsUpdate = true;
          }
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

    // Note: geometry disposal (including shadowMesh.geometry) is handled by
    // disposeObject3D() in event/index.ts before removedFromWorld is dispatched.
    // We only need to remove shadowMesh from the scene graph here.
    if (this.shadowMesh) {
      this.remove(this.shadowMesh);
      this.shadowMesh = undefined;
    }

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
    // atlas cost `attach_terrain_mesh_cost` just seeded. Leaving accounting to
    // the entity despawn keeps both paths correct.
    this.reportedDrapeGpuBytes = 0;

    // Release the watermask DataTexture (one per tile, RedFormat 1×1 or 256×256).
    this.userData.watermask?.texture?.dispose();

    // Clean up from tileMapByHandle
    if (tileMapByHandle) {
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
