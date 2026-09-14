import { type TileHandle } from "@navaramap/core";
import {
  Color,
  DataTexture,
  GLSL3,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

import {
  buildCompositeFragmentShader,
  composeCompositeContributions,
  compositeFeatureKey,
  COMPOSITE_VERTEX_SHADER,
  createCoreUniformMutates,
  createCompositeLayerEnhancers,
  type CompositeLayerEnhancer,
  type CompositeUniformTarget,
  type CoreUniformMutates,
} from "../material/enhancer/tileComposite";
import { type TexturizedSceneByTileCoordinates } from "../scene";

import type { SlotPlan } from "./SlotPlanner";
import { TileTextureCache } from "./TileTextureCache";
import type {
  AtlasFactory,
  CompositeAtlas,
  CompositeFeatures,
  CompositeGlobals,
  CompositeOutputs,
  DirtyReason,
} from "./types";

const PREV_CLEAR_COLOR = new Color();

/** MSAA sample count for the shared vector-drape bake target. The flat bake
 * shaders have no analytic edge AA, so geometric edges (fill borders, stroke
 * rims) are resolved at bake time. 4 samples on RGBA8 is guaranteed by
 * WebGL2. */
export const DRAPE_BAKE_SAMPLES = 4;

/**
 * Default atlas factory: a single MRT WebGLRenderTarget (count=3) sized
 * `size × size` with RGBA8 textures. All three attachments share format —
 * three.js's MRT API doesn't allow per-attachment formats — so we trade some
 * attr-channel precision for one draw call to populate color/attr/normal.
 */
export const defaultAtlasFactory =
  (renderer: WebGLRenderer | null): AtlasFactory =>
  (size: number): CompositeAtlas => {
    void renderer;
    const target = new WebGLRenderTarget(size, size, {
      count: 3,
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const [color, attr, normal] = target.textures;
    return {
      target,
      color,
      attr,
      normal,
      dispose: () => target.dispose(),
    };
  };

export type TileTextureCompositorOptions = {
  renderer: WebGLRenderer;
  texturizedSceneByTileCoordinates: TexturizedSceneByTileCoordinates;
  /** Rust's clamped WebMercator northing (`TileHandler.mercatorY`), handed to
   * the core uniform mutates so the paste-side reprojection constants come
   * from the same implementation as the Rust bake affine. */
  mercatorY: (lat: number) => number;
  /** Atlas RT side length (defaults to 512). */
  size?: number;
  /** Test seam: replace MRT RT creation. */
  atlasFactory?: AtlasFactory;
};

type CachedMaterial = {
  material: ShaderMaterial;
  /** Number of compact slots (rasterCount + vectorCount). */
  numTextures: number;
  /** Owns the core per-slot uniforms (shows/colors/opacities/textures/uv). */
  core: CoreUniformMutates;
  /** Active composite layer enhancers — each owns its own uniforms. */
  chain: CompositeLayerEnhancer[];
  /** 1×1 fallback so unbound texture array slots stay valid samplers. */
  placeholderTexture: Texture;
};

/** One WebMercator raster tile texture to bake into a layer's render target,
 * framed by the Rust-resolved mercator affine (terrain `[0,1]` UV → source UV). */
export type RasterBakeSource = {
  texture: Texture;
  uvOffset: [number, number];
  uvScale: [number, number];
};

/** One baked raster layer: its overlapping WM tile textures, mosaicked into one
 * render target. Heatmap layers carry encoded DEM, copied raw (nearest, no
 * color conversion) so the composite decode stays valid. */
export type RasterBakeSlot = {
  isElevationHeatmap: boolean;
  /**
   * The decoder's no-data (boundary) color for heatmap slots: painted across
   * the render target before the sources so uncovered regions decode as
   * "no elevation" — the no-data story lives entirely in the encoded-elevation
   * domain, keeping the alpha channel free for future RGBA encodings. Absent
   * for color slots and for decoders with no byte-representable boundary.
   */
  noDataColor?: [number, number, number];
  sources: RasterBakeSource[];
};

/**
 * Integration layer for per-tile texture composition.
 *
 * Responsibilities:
 * - Owns the per-tile composite atlas via TileTextureCache.
 * - Runs the per-layer vector-scene offscreen render (ported wholesale from
 *   the previous TileMesh._onBeforeRender so behaviour is unchanged).
 * - Runs the MRT composite pass that bakes N source textures (raster + vector
 *   + hillshade) into the atlas (color + attr + normal). The TileMesh main
 *   shader then samples each atlas attachment once instead of looping over N
 *   slots per fragment.
 * - Tracks dirty handles so the composite pass only runs when something
 *   actually changes (tile add, layer update, hillshade backfill, vector
 *   revision bump, …).
 */
export class TileTextureCompositor {
  readonly renderer: WebGLRenderer;
  readonly cache: TileTextureCache;
  /** Atlas / drape RT side length in texels (device-dependent). TileMesh reads
   * this to size its lazily-allocated drape render targets and to compute the
   * per-tile GPU byte cost it reports to the memory ledger. */
  readonly size: number;
  private readonly texturizedScenes: TexturizedSceneByTileCoordinates;
  private readonly mercatorY: (lat: number) => number;
  // Single camera shared by every drape bake (vector and raster), re-framed
  // per source by `frameBakeCamera`. Ancestor fallback is resolved in Rust,
  // so no per-tile camera transform is needed.
  private readonly bakeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Composite-pass machinery (lazily created on first use so tests that
  // don't render don't pay the allocation).
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadMesh: Mesh;
  private readonly materialCache = new Map<string, CachedMaterial>();
  // Drape render targets this compositor has ever rendered to. three.js
  // allocates a render target's GL framebuffer on first setRenderTarget, so
  // an empty slot whose target was never touched must be skipped entirely —
  // clearing it would allocate size² × 4 bytes of GPU memory for nothing.
  private readonly touchedTargets = new WeakSet<WebGLRenderTarget>();

  // Raster-bake machinery (lazily used): a textured quad drawn once per source
  // through the same windowing camera as the vector bake. `toneMapped: false` +
  // per-kind texture color spaces keep the bake a value-preserving copy.
  //
  // `transparent: true` + `blending: NoBlending` carries the source ALPHA into
  // the render target: an opaque material (transparent=false + NormalBlending)
  // gets three.js's `OPAQUE` define, whose shader forces `diffuseColor.a = 1.0`
  // and destroys the tile's transparency. NoBlending keeps replace semantics —
  // sources are disjoint WM tiles (plus a coarse-first ancestor underlay), so
  // each draw must overwrite, not blend, and straight (r, g, b, a) texels land
  // in the target for the composite's own alpha blend.
  private readonly rasterBakeScene = new Scene();
  private readonly rasterBakeMaterial = new MeshBasicMaterial({
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: NoBlending,
  });
  // Vector-bake MSAA machinery: ONE shared multisampled target for every
  // vector drape bake, so the multisample storage is a single fixed
  // allocation instead of a per-tile cost. A slot's sources accumulate into
  // it across render() calls — legal on WebGL2, where multisample
  // renderbuffer contents persist across the per-render resolves — and the
  // resolved image is then copied into the slot target once.
  private msaaBakeTarget: WebGLRenderTarget | null = null;
  // Resolve copy into the slot target: the MSAA resolve averages covered and
  // transparent samples, i.e. it premultiplies color by coverage — but the
  // composite blends slots as STRAIGHT alpha, so the copy divides it back
  // out. NoBlending + no color-space conversion keeps it value-preserving
  // otherwise (both textures stay NoColorSpace).
  private readonly msaaResolveMaterial = new ShaderMaterial({
    uniforms: { map: { value: null as Texture | null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(map, vUv);
        gl_FragColor = vec4(t.a > 0.0 ? t.rgb / t.a : vec3(0.0), t.a);
      }`,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });

  // 1×1 no-data underlay for baked heatmap targets, drawn through the same
  // value-preserving bake pipeline as the sources — a texture upload is
  // byte-exact, whereas a clear color would pass through the renderer's color
  // management and could land one byte off (fatal for positional encodings,
  // where the high byte weighs 65536 in decoded x). Cached per color.
  private demNoDataTexture: DataTexture | null = null;
  private demNoDataTextureKey = "";

  constructor(opts: TileTextureCompositorOptions) {
    this.renderer = opts.renderer;
    this.texturizedScenes = opts.texturizedSceneByTileCoordinates;
    this.mercatorY = opts.mercatorY;
    this.size = opts.size ?? 512;
    this.cache = new TileTextureCache({
      size: this.size,
      atlasFactory: opts.atlasFactory ?? defaultAtlasFactory(opts.renderer),
    });

    // Single shared fullscreen quad — material is swapped per render.
    this.quadMesh = new Mesh(new PlaneGeometry(2, 2));
    this.quadScene.add(this.quadMesh);
    this.quadCamera.position.z = 1;
    this.bakeCamera.position.z = 1;

    // Raster-bake quad: spans the source tile's NDC frame like a vector scene,
    // so the same windowing camera math frames it. Shares the fullscreen quad
    // geometry with `quadMesh` (both are static [-1, 1] planes; the windowing
    // lives in the camera), so dispose() frees one geometry for both.
    this.rasterBakeScene.add(
      new Mesh(this.quadMesh.geometry, this.rasterBakeMaterial),
    );
  }

  // ---------------------------------------------------------------------
  // Cache-facing API
  // ---------------------------------------------------------------------

  acquire(handle: TileHandle): CompositeOutputs {
    return this.cache.acquire(handle);
  }

  release(handle: TileHandle): void {
    this.cache.release(handle);
  }

  /** Refcount-neutral accessor for an already-acquired handle's atlas. */
  acquireOutputs(handle: TileHandle): CompositeOutputs {
    const out = this.cache.getOutputs(handle);
    if (!out) {
      throw new Error(
        `TileTextureCompositor: handle not acquired before requesting outputs`,
      );
    }
    return out;
  }

  markDirty(handle: TileHandle, reason: DirtyReason): void {
    this.cache.markDirty(handle, reason);
  }

  // ---------------------------------------------------------------------
  // Vector-scene render
  // ---------------------------------------------------------------------

  /**
   * Bake each resolved vector layer's WM source scenes into its per-layer render
   * target (slot `i` → `renderTargets[i]`). A layer can be backed by several WM
   * vector tiles when the terrain is Geographic (N:M); every source is drawn into
   * the one render target, each framed by the Rust-supplied mercator affine
   * `uvOffset`/`uvScale` so it lands in its sub-rect. Since the affine maps the
   * terrain tile's `[0, 1]` UV into the source frame, the render-target UV ends up
   * equal to the terrain UV — i.e. the RT spans the terrain tile's extent, ready
   * for the composite paste's latitude reprojection. `(0,0)/(1,1)` (an exact
   * same-tile drape, WebMercator terrain) maps a single source to the full RT.
   *
   * The mosaic target is cleared once, then each source is drawn additively
   * (autoClear off) so the sources mosaic instead of overwriting one another. A
   * source whose scene hasn't reached the cache yet is skipped; its sub-rect stays
   * transparent until it arrives (no flashing — coarser ancestors back the gaps
   * via the Rust scene-ready walk-up). The caller owns the dirty gate and only
   * calls this when the resolved slots or scenes change.
   *
   * With `antialias` (the default), the scenes render through the shared MSAA
   * bake target and the resolved image is copied into the slot's render target
   * (see `msaaBakeTarget` / `msaaResolveMaterial`). Pick bakes MUST pass
   * `antialias: false`: their fragments encode batch ids as colors, and the
   * MSAA resolve averages them along feature edges into ids that don't exist —
   * they render straight into the slot target instead, keeping hard edges.
   */
  renderVectorScenes(
    slots: {
      layerId: string;
      sources: {
        tileHandle: TileHandle;
        uvOffset: [number, number];
        uvScale: [number, number];
      }[];
    }[],
    renderTargets: WebGLRenderTarget[],
    { antialias = true }: { antialias?: boolean } = {},
  ): void {
    this.bakeSlotTargets(
      slots,
      renderTargets,
      (slot) => {
        const sources: {
          scene: Scene;
          uvOffset: [number, number];
          uvScale: [number, number];
        }[] = [];
        for (const source of slot.sources) {
          const scene = this.texturizedScenes.findSceneByLayerId(
            source.tileHandle,
            slot.layerId,
          );
          if (!scene || scene.removed || !scene.children.length) continue;
          sources.push({
            scene,
            uvOffset: source.uvOffset,
            uvScale: source.uvScale,
          });
        }
        if (!sources.length) return null;

        // The framed camera works for both paths: it draws each source into
        // its sub-rect of whichever target is bound (the MSAA intermediate or
        // the slot target directly).
        return () => {
          for (const s of sources) {
            this.renderer.render(
              s.scene,
              this.frameBakeCamera(s.uvOffset, s.uvScale),
            );
          }
        };
      },
      antialias ? () => this.acquireMsaaBakeTarget() : undefined,
    );
  }

  /** The shared multisampled vector-bake target, allocated on first use. No
   * depth/stencil: every bake material draws with depth test/write off. */
  private acquireMsaaBakeTarget(): WebGLRenderTarget {
    this.msaaBakeTarget ??= new WebGLRenderTarget(this.size, this.size, {
      format: RGBAFormat,
      samples: DRAPE_BAKE_SAMPLES,
      depthBuffer: false,
      stencilBuffer: false,
    });
    return this.msaaBakeTarget;
  }

  /** GPU bytes of the shared MSAA bake target (multisample renderbuffer +
   * resolve texture), for the fixed-footprint report — a single allocation
   * the per-tile drape accounting cannot see. Zero until first use. */
  fixedGpuBytes(): number {
    return this.msaaBakeTarget
      ? this.size * this.size * 4 * (DRAPE_BAKE_SAMPLES + 1)
      : 0;
  }

  /**
   * Bake each raster layer's overlapping WM tile textures into ONE render
   * target (slot `i` → `renderTargets[i]`), mirroring {@link renderVectorScenes}:
   * every source is a textured quad framed by the Rust-supplied mercator affine
   * `uvOffset`/`uvScale`, so the render target ends up spanning the terrain
   * tile's (Mercator-projected) extent and the composite treats the whole layer
   * as one slot with the terrain-band reprojection — instead of one composite
   * slot per overlapping tile, which overflowed the GPU slot budget on
   * Geographic terrain once 3+ layers were draped.
   *
   * Sources are drawn coarse-first (ascending `uvScale`): an ancestor fallback
   * covers the whole terrain rect, so painting it first lets the finer tiles
   * overwrite it instead of being buried under coarse texels. The bake is a
   * value-preserving copy (`toneMapped: false`; per-kind color spaces below), so
   * heatmap DEM texels survive it bit-faithfully:
   * - color imagery: source + target declared sRGB — decode at fetch, encode at
   *   write, decode again at the composite fetch: the same linear values the
   *   direct (non-baked) path produced.
   * - elevation heatmap: everything `NoColorSpace` + nearest — raw texels, no
   *   interpolation, so the composite's decode-then-interpolate keeps working.
   */
  renderRasterTiles(
    slots: (RasterBakeSlot | undefined)[],
    renderTargets: (WebGLRenderTarget | undefined)[],
  ): void {
    this.bakeSlotTargets(slots, renderTargets, (slot) => () => {
      // Heatmap targets: paint the decoder's no-data color across the whole
      // target first, so regions no source covers decode as "no elevation"
      // (the composite renders them transparent) instead of decoding the
      // cleared black as a height.
      if (slot.isElevationHeatmap && slot.noDataColor) {
        this.drawRasterBakeQuad(
          this.demNoDataUnderlay(slot.noDataColor),
          true,
          [0, 0],
          [1, 1],
        );
      }

      // Coarse-first painter's order: a shared ancestor spans every finer
      // source's rect, so it must not be drawn over them.
      const sources = [...slot.sources].sort(
        (a, b) => a.uvScale[0] - b.uvScale[0],
      );
      for (const source of sources) {
        this.drawRasterBakeQuad(
          source.texture,
          slot.isElevationHeatmap,
          source.uvOffset,
          source.uvScale,
        );
      }
    });
  }

  /**
   * Shared bake loop over per-layer drape render targets (slot `i` →
   * `renderTargets[i]`): saves/restores the renderer state and owns every
   * target/clear decision. `prepareSlot` returns the slot's draw closure, or
   * null when it has nothing to draw. autoClear stays off so a closure's
   * multiple draws mosaic into one cleared target instead of wiping it.
   *
   * Without `via`, the closure draws straight into the slot target (cleared
   * first). With `via` (the shared MSAA intermediate — a lazy getter so it is
   * only ever GL-allocated when something actually draws), the closure draws
   * into the cleared intermediate and the resolved image is copied into the
   * slot target by the full-frame resolve quad, which overwrites every texel
   * (NoBlending), so the slot target itself needs no clear. A slot with
   * nothing to draw is cleared either way — wiping a stale previous bake —
   * except when its target was never touched: render-targeting it then would
   * allocate its GL storage for nothing.
   */
  private bakeSlotTargets<S>(
    slots: readonly (S | undefined)[],
    renderTargets: readonly (WebGLRenderTarget | undefined)[],
    prepareSlot: (slot: S) => (() => void) | null,
    via?: () => WebGLRenderTarget,
  ): void {
    const prevTarget = this.renderer.getRenderTarget();
    const prevClear = this.renderer.getClearColor(PREV_CLEAR_COLOR);
    const prevClearAlpha = this.renderer.getClearAlpha();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;

    for (let i = 0; i < renderTargets.length; i++) {
      const renderTarget = renderTargets[i];
      if (!renderTarget) continue;

      const slot = slots[i];
      const draw = slot ? prepareSlot(slot) : null;
      if (!draw && !this.touchedTargets.has(renderTarget)) continue;
      this.touchedTargets.add(renderTarget);

      if (draw && via) {
        const intermediate = via();
        this.renderer.setRenderTarget(intermediate);
        this.renderer.setClearColor(0x000, 0);
        this.renderer.clear();
        draw();
        this.renderer.setRenderTarget(renderTarget);
        this.drawMsaaResolveQuad(intermediate.texture);
      } else {
        this.renderer.setRenderTarget(renderTarget);
        this.renderer.setClearColor(0x000, 0);
        this.renderer.clear();
        draw?.();
      }

      renderTarget.texture.needsUpdate = true;
    }

    this.renderer.autoClear = prevAutoClear;
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearColor(prevClear, prevClearAlpha);
  }

  /** Copy a resolved MSAA image into the current render target, dividing
   * coverage back out (see `msaaResolveMaterial`). */
  private drawMsaaResolveQuad(texture: Texture): void {
    this.msaaResolveMaterial.uniforms.map.value = texture;
    this.quadMesh.material = this.msaaResolveMaterial;
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /**
   * Frame the shared bake camera on the terrain tile's sub-rect of a source
   * from the mercator affine: meshUv ∈ [0,1] → sourceUv = uvOffset +
   * meshUv·uvScale, source NDC = 2·sourceUv − 1. A source finer than the
   * terrain tile yields a camera wider than [-1, 1], so it draws into only
   * its sub-rect and leaves the rest of the render target transparent.
   */
  private frameBakeCamera(
    uvOffset: [number, number],
    uvScale: [number, number],
  ): OrthographicCamera {
    const [ox, oy] = uvOffset;
    const [sx, sy] = uvScale;
    const camera = this.bakeCamera;
    camera.left = 2 * ox - 1;
    camera.right = 2 * (ox + sx) - 1;
    camera.bottom = 2 * oy - 1;
    camera.top = 2 * (oy + sy) - 1;
    camera.updateProjectionMatrix();
    return camera;
  }

  /** Draw one textured quad into the current render target through the bake
   * camera window — the value-preserving copy described on
   * {@link renderRasterTiles}. */
  private drawRasterBakeQuad(
    texture: Texture,
    isElevationHeatmap: boolean,
    uvOffset: [number, number],
    uvScale: [number, number],
  ): void {
    const material = this.rasterBakeMaterial;
    this.configureRasterBakeSource(texture, isElevationHeatmap);
    // First map assignment flips USE_MAP; later swaps are uniform-only.
    if (material.map === null) material.needsUpdate = true;
    material.map = texture;
    this.renderer.render(
      this.rasterBakeScene,
      this.frameBakeCamera(uvOffset, uvScale),
    );
  }

  /** The cached 1×1 no-data texture, (re)created when the color changes. */
  private demNoDataUnderlay(color: [number, number, number]): DataTexture {
    const key = color.join(",");
    if (!this.demNoDataTexture || this.demNoDataTextureKey !== key) {
      this.demNoDataTexture?.dispose();
      const texture = new DataTexture(
        new Uint8Array([...color, 255]),
        1,
        1,
        RGBAFormat,
        UnsignedByteType,
      );
      texture.needsUpdate = true;
      this.demNoDataTexture = texture;
      this.demNoDataTextureKey = key;
    }
    return this.demNoDataTexture;
  }

  /** Value-preserving sampler settings for a bake source texture (see
   * {@link renderRasterTiles}); idempotent so re-bakes don't re-upload. */
  private configureRasterBakeSource(tex: Texture, isElevationHeatmap: boolean) {
    const colorSpace = isElevationHeatmap ? NoColorSpace : SRGBColorSpace;
    const filter = isElevationHeatmap ? NearestFilter : LinearFilter;
    if (
      tex.colorSpace !== colorSpace ||
      tex.minFilter !== filter ||
      tex.magFilter !== filter ||
      tex.generateMipmaps
    ) {
      tex.colorSpace = colorSpace;
      tex.minFilter = filter;
      tex.magFilter = filter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------------
  // MRT composite pass
  // ---------------------------------------------------------------------

  /**
   * Run the composite MRT pass for a handle if (and only if) its atlas is
   * dirty. Consumes the dirty flags on success so the next frame skips work
   * unless something marks it dirty again.
   *
   * The pass writes:
   *   color  attachment  = alpha-composited diffuse over N slots
   *   attr   attachment  = water + texturized-layer flags + winning slot idx
   *   normal attachment  = hillshade normal (or neutral)
   *
   * Returns true when a render happened.
   */
  runCompositePassIfDirty(
    handle: TileHandle,
    plan: SlotPlan,
    globals: CompositeGlobals,
    features: CompositeFeatures,
  ): boolean {
    if (!this.cache.isDirty(handle)) return false;
    const entry = this.cache.getEntry(handle);
    if (!entry) return false;

    const prevTarget = this.renderer.getRenderTarget();
    const prevClear = this.renderer.getClearColor(PREV_CLEAR_COLOR);
    const prevClearAlpha = this.renderer.getClearAlpha();

    // No active slots → either clear (nothing to bake) or fall through to the
    // shader path when a slot-independent feature still needs to write the
    // atlas. Currently that's watermask only: it samples a per-tile texture
    // and bakes the result into attr.r so water reflection works on tiles
    // that have no raster/vector layers (e.g. open-ocean quantized-mesh).
    const noSlots = plan.rasterCount + plan.vectorCount === 0;
    if (noSlots && !features.hasWatermask) {
      this.renderer.setRenderTarget(entry.atlas.target);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearColor(prevClear, prevClearAlpha);
      entry.atlas.color.needsUpdate = true;
      entry.atlas.attr.needsUpdate = true;
      entry.atlas.normal.needsUpdate = true;
      this.cache.consumeDirty(handle);
      return true;
    }

    const mat = this.getOrCreateMaterial(plan, features);

    this.bindUniforms(mat, plan, globals);
    this.quadMesh.material = mat.material;

    this.renderer.setRenderTarget(entry.atlas.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.quadScene, this.quadCamera);

    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearColor(prevClear, prevClearAlpha);

    entry.atlas.color.needsUpdate = true;
    entry.atlas.attr.needsUpdate = true;
    entry.atlas.normal.needsUpdate = true;

    this.cache.consumeDirty(handle);
    return true;
  }

  private getOrCreateMaterial(
    plan: SlotPlan,
    features: CompositeFeatures,
  ): CachedMaterial {
    const { rasterCount, vectorCount, boundary } = plan;
    const numTextures = rasterCount + vectorCount;
    const key = `${rasterCount}|${vectorCount}|${boundary}|${compositeFeatureKey(features)}`;
    const cached = this.materialCache.get(key);
    if (cached) return cached;

    // 1×1 transparent placeholder. A bare `new Texture()` has no image and
    // triggers a "Texture marked for update but no image data found" warning
    // when three.js tries to upload it.
    const placeholderTexture = new DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1,
      1,
      RGBAFormat,
      UnsignedByteType,
    );
    placeholderTexture.needsUpdate = true;

    // Build the enhancer chain once and use it for both shader generation and
    // uniform ownership: each active enhancer attaches its own uniform refs and
    // contributes the matching GLSL, so a new expression touches only its module.
    const chain = createCompositeLayerEnhancers(features);
    const core = createCoreUniformMutates(this.mercatorY);

    const uniforms: CompositeUniformTarget = {};
    core.attachUniforms(uniforms, numTextures, placeholderTexture);
    let defines: Record<string, number> = {};
    for (const enhancer of chain) {
      enhancer.attachUniforms?.(uniforms, numTextures, placeholderTexture);
      if (enhancer.defines) defines = { ...defines, ...enhancer.defines };
    }

    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      defines,
      uniforms,
      vertexShader: COMPOSITE_VERTEX_SHADER,
      fragmentShader: buildCompositeFragmentShader(
        rasterCount,
        vectorCount,
        boundary,
        composeCompositeContributions(chain, numTextures),
      ),
      depthTest: false,
      depthWrite: false,
    });

    const entry: CachedMaterial = {
      material,
      numTextures,
      core,
      chain,
      placeholderTexture,
    };
    this.materialCache.set(key, entry);
    return entry;
  }

  private bindUniforms(
    mat: CachedMaterial,
    plan: SlotPlan,
    globals: CompositeGlobals,
  ): void {
    // Single pass over the compact slots: the base binds the core uniforms and
    // each active enhancer fills its own per-slot ref for the same slot.
    for (let k = 0; k < mat.numTextures; k++) {
      const layer = plan.slots[k]?.layer;
      mat.core.bindSlot(k, layer);
      for (const enhancer of mat.chain) enhancer.bindSlot?.(k, layer);
    }
    for (const enhancer of mat.chain) enhancer.bindGlobal?.(globals);
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  dispose(): void {
    this.cache.disposeAll();
    for (const m of this.materialCache.values()) {
      m.material.dispose();
      m.placeholderTexture.dispose();
    }
    this.materialCache.clear();
    // Also frees the raster-bake quad, which shares this geometry.
    this.quadMesh.geometry.dispose();
    this.rasterBakeMaterial.dispose();
    this.msaaResolveMaterial.dispose();
    this.msaaBakeTarget?.dispose();
    this.msaaBakeTarget = null;
    this.demNoDataTexture?.dispose();
    this.demNoDataTexture = null;
  }
}
