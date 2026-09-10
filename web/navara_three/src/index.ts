import { EventManager, EventHandler, Globe, Plugin } from "@navaramap/core";
import type {
  CameraPosition,
  ColorMap,
  GlobeOptions,
  Nullable,
  XYZ,
  Color as CoreColor,
  LatLngHeight,
  LatLng,
} from "@navaramap/core";
import initCore, {
  Core,
  CameraDirection,
  DynamicSse as EngineDynamicSse,
  LLE,
  type TerrainHeightUpdatedEvent,
  type TextureFragmentStatus,
} from "@navaramap/engine";
import {
  FontManager,
  type FontFamily,
  type FontWorkerMemoryStats,
} from "@navaramap/font";
import FontWorkerURL from "@navaramap/font/fontWorker?worker&url";
import { initNavaraApi, degreeToRadian } from "@navaramap/three-api";
import {
  initializeWorkerPool,
  probeWorkerPoolHeap,
  terminateWorkerPool,
  warmUpWorkerPool,
  workerPoolHeapStats,
  type WorkerPoolHeapStats,
} from "@navaramap/worker";
import {
  Scene,
  WebGLRenderer,
  Vector3,
  Texture,
  Vector2,
  LinearFilter,
  ClampToEdgeWrapping,
  RepeatWrapping,
  Group,
  PCFShadowMap,
} from "three";
import invariant from "tiny-invariant";

import { Atmosphere, type AtmosphereOptions } from "./atmosphere";
import { ThreeViewCamera } from "./camera";
import { Color } from "./Color";
import { createDefaultConcurrencyManager } from "./concurrency";
import { WATER_NORMAL_URL } from "./constants/assets";
import {
  LightDesc,
  EffectDesc,
  ViewContext,
  type MeshConfig,
  type LightConfig,
  type EffectConfig,
  type MeshDescConstructor,
  type LightDescConstructor,
  type EffectDescConstructor,
  UnknownTypeError,
} from "./core";
import {
  MeshHandle,
  LightHandle,
  EffectHandle,
  type AnyMeshDesc,
} from "./core/BaseHandle";
import { Registries } from "./core/Registries";
import { DeclutterManager, wasmDeclutterKernel } from "./declutter";
import {
  getCompositeAtlasSize,
  getDefaultDynamicSse,
  getDefaultLodFog,
  getDefaultMemoryBudgets,
  getDefaultMemoryCostHints,
  getDevicePixelRatio,
  isMobileDevice,
  type DynamicSseSettings,
  type LodFogSettings,
} from "./device";
import {
  processEvent,
  EventContext,
  HillshadeContext,
  type BufferLoader,
  type FeatureHandler,
  type GlobeHandler,
  type LayerHandler,
  type MeshHandler,
  type TextureFragmentHandler,
  type TileHandler,
  type WorkerTaskHandler,
} from "./event";
import { TEXTURE_LOADER } from "./event/loaders";
import { createTileHandler } from "./event/tileHandler";
import { InMemoryBufferStore } from "./inMemoryBufferStore";
import { registerInputEvents } from "./input";
import { Layer, type LayerEvent } from "./layer";
import {
  MRTPassEffectDesc,
  SkyEnvMapEffectDesc,
  TransparentPassEffectDesc,
} from "./layers/effect";
import { FinalCopyEffectDesc } from "./layers/effect/FinalCopyEffectDesc";
import { LayersManager } from "./layersManager";
import { disposeTexture } from "./loaders";
import {
  overrideMaterialsForMRT,
  GBUFFER_ATTACHMENT_NAMES,
  resolveGBufferOptions,
  unionGBufferRequirements,
  type GBufferName,
  type ResolvedGBufferOptions,
} from "./material";
import type { TileMesh } from "./mesh/tile";
import { RenderPassOrchestrator } from "./orchestrators/RenderPassOrchestrator";
import {
  CLICK_PIXEL_TOLERANCE,
  isClickGesture,
  PickHelper,
  TAP_PIXEL_TOLERANCE,
} from "./pick/pickHelper";
import { TerrainPicker } from "./pick/pickTerrain";
import { AttributionPlugin, type AttributionPluginOptions } from "./plugins";
import { TexturizedSceneByTileCoordinates, type Scenes } from "./scene";
import { ShadowMapViewers } from "./ShadowMapViewers";
import { Source } from "./source";
import { RendererStats } from "./stats";
import {
  sampleTerrainMostDetailed,
  type SampleTerrainOptions,
  type SampledTerrainPosition,
  type TerrainSampleSource,
} from "./terrain/sampleTerrainMostDetailed";
import { hasObservedTerrainHeight } from "./terrain/terrainHeightEvent";
import type { TextureOptions } from "./textures";
import { TileTextureCompositor } from "./tileTexture";
import {
  type AbortControllers,
  type LayerDescription,
  type SourceDescription,
  type BuiltInEffectDescription,
  type Descriptions,
  type EmptyDescriptions,
  type OmitType,
  type MeshCache,
  type PickedFeature,
  type WorkerPoolPromises,
  type RenderFlag,
  type TileMapByHandle,
  type SourceRef,
} from "./type";
import type { CommonUniforms } from "./uniforms";
import { isWorker, convertScreenPos, type TextureSlot } from "./utils";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
/** @ts-ignore ignore: https://v3.vitejs.dev/guide/features.html#import-with-query-suffixes  */
import WorkerURL from "./worker?url&worker";

export type { CameraOptions, CameraEvent } from "./camera";

/** Easing presets applied to a `flyTo` flight's normalized time. */
export type FlyToEasing =
  "linear" | "quadInOut" | "cubicInOut" | "cubicOut" | "quinticInOut";

export type FlyToOptions = {
  /** Animation duration in milliseconds. Defaults to a duration derived from
   * the flight distance (2–3 s). Pass `0` to jump instantly. */
  duration?: number;
  /** Maximum height during the flight arc in meters. */
  maxHeight?: number;
  /** Easing preset. Defaults to `"quinticInOut"`, or `"cubicOut"` when
   * descending from above 11,500 m. */
  easing?: FlyToEasing;
};

// Must mirror `FlyToEasing`'s `TryFrom<u8>` mapping on the Rust side.
const FLY_TO_EASING_CODE: Record<FlyToEasing, number> = {
  linear: 0,
  quadInOut: 1,
  cubicInOut: 2,
  cubicOut: 3,
  quinticInOut: 4,
};

export { ColorMap, EventHandler, Plugin } from "@navaramap/core";
export type {
  Nullable,
  XYZ,
  LatLng,
  LatLngHeight,
  CameraOrientation,
  CameraPosition,
  ColorTuple,
  LUT,
  Globe,
  Observed,
  ObservedEvent,
} from "@navaramap/core";
export { CameraDirection } from "@navaramap/engine";
// CSM exports for advanced users
export { CascadedShadowMaps, CSMHelper } from "@navaramap/three-csm";

export * from "./type";
export type {
  SampleTerrainOptions,
  SampledTerrainPosition,
} from "./terrain/sampleTerrainMostDetailed";
export * from "./constants";
export * from "./light";
export * from "./mesh";
export * from "./layer";
export * from "./source";
export * from "./effects";
export * from "./shaders";
export * from "./material";
export * from "./core";
export { BufferView } from "./bufferView";
export * from "./plugins";
export * from "./layers";
export * from "./passes";
export * from "./evaluations";
export { SKY_RENDER_ORDER, STARS_RENDER_ORDER } from "./renderOrder";
export {
  CLICK_PIXEL_TOLERANCE,
  TAP_PIXEL_TOLERANCE,
  PICK_RADIUS,
  TOUCH_PICK_RADIUS,
} from "./pick/pickHelper";
export * from "@navaramap/three-api";
export * from "./Color";
export { type BlendMode, blendFunction, createReplacer } from "./utils";
export { Atmosphere, type AtmosphereOptions } from "./atmosphere";
export type { Quality } from "./quality";
export type { CustomObject3DEventMap } from "./object3DEvent";
export type {
  FontFamily,
  FontFace,
  UnicodeRange,
  FontWorkerMemoryStats,
} from "@navaramap/font";
export {
  fetchFontFamilyFromCss,
  parseCssUnicodeRange,
  parseFontFamilyFromCss,
} from "@navaramap/font";
export type {
  CssFontFaceFilter,
  FetchCssFontFamilyOptions,
  ParseCssFontFamilyOptions,
} from "@navaramap/font";
export {
  getDefaultCacheBytes,
  getDefaultDynamicSse,
  getDefaultLodFog,
  getDefaultMemoryBudgets,
  MB,
  type DynamicSseSettings,
  type LodFogSettings,
  type MemoryBudgets,
} from "./device";

/**
 * Snapshot of engine memory usage; see {@link ThreeView.memoryStats}. Plain
 * object (not the WASM-generated class) per the WASM API policy: the class is
 * copied field-by-field and freed before returning.
 */
export type MemoryStats = {
  bufferTotalBytes: number;
  /** Bytes held in the JS-side `InMemoryBufferStore` (WASM `External`
   * entries): fetched MVT pbf and worker-built geometry that never enter WASM
   * linear memory. Not part of `bufferTotalBytes`. */
  externalBufferBytes: number;
  bufferCount: number;
  gpuBytesEst: number;
  externalCpuBytes: number;
  reservedBytes: number;
  /** Estimated GPU bytes of fixed screen-sized allocations (the
   * postprocessing render-target stack), reported via
   * `Core.setFixedGpuBytes` on init, resize, and pass-list changes. */
  fixedGpuBytes: number;
  budgetBytes: number | undefined;
  evictedCount: number;
  sseMultiplier: number;
  retainedVector: number;
  retainedTerrain: number;
  retainedRaster: number;
  retainedTiles3d: number;
};

/** Snapshot of worker-side memory; see {@link ThreeView.workerMemoryStats}. */
export type WorkerMemoryStats = {
  /** Tile-worker pool heaps (undefined per slot until first probed). */
  tileWorkers: WorkerPoolHeapStats | undefined;
  /** Font worker heap/cache breakdown; undefined while no font is in use. */
  fontWorker: FontWorkerMemoryStats | undefined;
};

/**
 * Configuration options for initializing ThreeView.
 */
export type Options = {
  /** Container element to append the canvas to. */
  container?: HTMLElement;
  /** Canvas element for rendering. If not provided, a new canvas is created. */
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  /** Device pixel ratio override. When not specified, the device value is
   * used, capped at 2 on mobile (1 with `mobileOptimization`) — screen-sized
   * render targets grow quadratically with pixel ratio and dominate mobile
   * GPU memory. An explicit value bypasses the caps. */
  pixelRatio?: number;
  /** Disables automatic resize handling on window resize events. */
  disableAutoResize?: boolean;
  /** Enables debug mode with performance stats overlay. */
  debug?: boolean;
  /** Atmosphere rendering configuration options. */
  atmosphere?: AtmosphereOptions;
  /** Background color of the scene. Defaults to dark color (0x0a0a0f). */
  backgroundColor?: CoreColor;
  /**
   * Feature picking configuration (default: true). Enables the `featureClick`
   * event (click or touch tap) and the `featureHover` / `featureEnter` /
   * `featureLeave` events (pointer hover).
   */
  picking?: boolean;
  /** When true, renders every frame. When false, renders only on changes or when forceUpdate() is called. */
  animation?: boolean;
  /** Number of samples for MSAA (Multi-Sample Anti-Aliasing). 0 disables MSAA. */
  multisampling?: number;
  /** Uses half-float precision for post-processing. Higher quality when true. @defaultValue true */
  halfFloat?: boolean;
  /** Enables logarithmic depth buffer for improved depth precision at large scales. @defaultValue true */
  logarithmicDepthBuffer?: boolean;
  /** Enables shadow mapping. Must be set at initialization time. */
  shadow?: boolean;
  /** Enables mobile device optimizations such as lower pixel ratio. */
  mobileOptimization?: boolean;
  /**
   * Milliseconds of inactivity (no Rust-side events) before the `idle` event fires.
   * @defaultValue 100
   */
  idleThreshold?: number;
  /**
   * Memory budget in bytes for tile caches (WASM buffers + estimated GPU
   * cost). Tiles leaving the view are retained until the budget is exceeded,
   * then evicted least-recently-visited first — panning back is refetch-free
   * while total usage stays capped. Naming follows Cesium3DTileset.cacheBytes.
   * @defaultValue device-dependent, see `getDefaultCacheBytes`
   */
  cacheBytes?: number;
  /**
   * LOD fog: distance-based screen-space-error relaxation used by tile LOD
   * selection — far tiles tolerate a larger error and stay coarser while
   * near tiles keep full resolution. Purely an LOD control; it never
   * affects visual fog rendering. Partial overrides are merged over the
   * device default.
   * @defaultValue device-memory-dependent, see `getDefaultLodFog`
   */
  lodFog?: Partial<LodFogSettings>;
  /**
   * Dynamic screen-space error (CesiumJS `dynamicScreenSpaceError`
   * equivalent): tilted, street-level horizon views tolerate a larger error
   * for far tiles, cutting the tile working set in exactly the views that
   * over-refine. Zero effect looking straight down. Partial overrides are
   * merged over the default.
   * @defaultValue see `getDefaultDynamicSse`
   */
  dynamicSse?: Partial<DynamicSseSettings>;
  /**
   * Overrides for the worker-side memory budgets (per-tile-worker WASM heap
   * recycle threshold and the font worker's cache budget). Defaults derive
   * from the device memory together with `cacheBytes` — see
   * `getDefaultMemoryBudgets`. The font budget caps *further growth* of the
   * font caches; WASM heaps never return memory to the OS.
   */
  memoryBudget?: {
    maxWorkerHeapBytes?: number;
    fontBudgetBytes?: number;
    /** In-flight data fetch cap per tile pipeline (see `getDefaultMemoryBudgets`). */
    maxPendingRequests?: number;
    /**
     * Resting (base) memory-pressure SSE multiplier. On mobile a value > 1
     * keeps far tiles coarser even when the budget is not exceeded. Defaults
     * per device — see `getDefaultSseMultiplierRange`.
     */
    sseMultiplierMin?: number;
    /**
     * Ceiling for the dynamic memory-pressure SSE degrade. A larger value lets
     * the engine shed more of the visible set under pressure before the tab is
     * killed. Defaults per device — see `getDefaultSseMultiplierRange`.
     */
    sseMultiplierMax?: number;
  };
  /**
   * Enables shared water texture. When enabled, a single water normal texture
   * is loaded once and shared across all meshes that have water effects enabled.
   */
  waterTexture?: {
    /** Whether to enable the shared water texture. */
    enabled: boolean;
    /** Custom water normal texture URL. Uses built-in texture if not specified. */
    url?: string;
  };
  /**
   * Attribution (credit) UI, on by default (accessed via
   * {@link ThreeView.attribution}). Pass `false` to opt out (e.g. to build your
   * own UI), or an object to configure the initial style / corner. Skipped in a
   * worker (no DOM), so `view.attribution` is `undefined` there.
   * @defaultValue true
   */
  defaultAttribution?: boolean | AttributionPluginOptions;
} & GlobeOptions;

/**
 * Pointer event extended with map coordinates at the event location.
 * Fired for every input type; `pointerType` tells them apart.
 */
export type MapPointerEvent = {
  /** World coordinates (ECEF) at the pointer position on the globe surface. */
  map: XYZ;
} & PointerEvent;

/**
 * Event types emitted by ThreeView. Subscribe using `view.on(eventName, callback)`.
 */
export type ViewEvents = {
  /** Emitted when the view is resized. Receives width and height in pixels. */
  resize: (w: number, h: number) => void;
  /**
   * Emitted when a feature is clicked or tapped (click-gesture GPU pick).
   * Receives the clicked feature, or null when empty space was clicked. For
   * raw click coordinates use the `click` event instead.
   */
  featureClick: (info: Nullable<PickedFeature>) => void;
  /**
   * Emitted when the hovered feature changes (hover picking). Receives
   * the newly hovered feature, or null when the pointer leaves all pickable
   * features. Hover picking runs a GPU pick per frame while the pointer
   * moves, and is active only while at least one `featureHover` /
   * `featureEnter` / `featureLeave` listener is registered.
   */
  featureHover: (info: Nullable<PickedFeature>) => void;
  /** Emitted when the pointer starts hovering a pickable feature. See `featureHover` for activation. */
  featureEnter: (info: PickedFeature) => void;
  /** Emitted when the pointer stops hovering the previously hovered feature. See `featureHover` for activation. */
  featureLeave: (info: PickedFeature) => void;
  /** Emitted when a layer event occurs. Receives event type, layer ID, and event arguments. */
  layer: <K extends keyof LayerEvent>(
    k: K,
    layerId: string,
    ...args: Parameters<LayerEvent[K]>
  ) => void;
  /** Emitted before an update process happens. Receives `DOMHighResTimeStamp` as a timestamp. */
  preUpdate: (t: number) => void;
  /** Emitted after an update process when state changes occurred. Receives `DOMHighResTimeStamp` as a timestamp. */
  postUpdate: (t: number) => void;
  /** Emitted before rendering. With `animation: true`, fires every frame. Receives `DOMHighResTimeStamp` as a timestamp. */
  preRender: (t: number) => void;
  /** Emitted after rendering. With `animation: true`, fires every frame. Receives `DOMHighResTimeStamp` as a timestamp. */
  postRender: (t: number) => void;
  /** @private Emitted when terrain height sampling completes. */
  _sample_terrain_height_received: (ev: TerrainHeightUpdatedEvent) => void;
  /** Emitted on pointerdown with map coordinates, for every input type. */
  pointerdown: (event: MapPointerEvent) => void;
  /** Emitted when a pointer enters the canvas with map coordinates, for every input type. */
  pointerenter: (event: MapPointerEvent) => void;
  /** Emitted when a pointer leaves the canvas with map coordinates, for every input type. */
  pointerleave: (event: MapPointerEvent) => void;
  /** Emitted on pointermove with map coordinates, for every input type. */
  pointermove: (event: MapPointerEvent) => void;
  /** Emitted on pointerup with map coordinates, for every input type. */
  pointerup: (event: MapPointerEvent) => void;
  /** Emitted when the browser cancels an active pointer (e.g. a system gesture takes over). */
  pointercancel: (event: PointerEvent) => void;
  /**
   * Emitted on a click or touch tap with map coordinates: a primary-pointer
   * press and release within the travel tolerance
   * ({@link CLICK_PIXEL_TOLERANCE}, or {@link TAP_PIXEL_TOLERANCE} for
   * touch). Camera drags and pinches never fire it. `pointerType` tells the
   * input kinds apart.
   */
  click: (event: MapPointerEvent) => void;
  /** Emitted when the engine becomes idle (no Rust-side events for `idleThreshold` ms). */
  idle: () => void;
};

/**
 * The main 3D globe view class that manages rendering, layers, camera, and user interaction.
 * Create an instance and call `init()` to start the engine.
 *
 * @example
 * ```typescript
 * const view = new ThreeView();
 * await view.init();
 * ```
 */
export default class ThreeView<
  D extends Descriptions = EmptyDescriptions,
> extends EventHandler<ViewEvents> {
  private _camera: ThreeViewCamera;
  private _renderer: WebGLRenderer;
  private _globe!: Globe;
  private _atmosphere: Atmosphere;

  /** Handle for the sky environment map effect descriptor. Used for sky reflections. */
  private skyEnvMap!: EffectHandle<SkyEnvMapEffectDesc>;
  /** Handle for the Multi-Render Target pass that outputs color and normal buffers. */
  private mrtPass!: EffectHandle<MRTPassEffectDesc>;
  /** Handle for the transparent objects rendering pass. */
  private transparentPass!: EffectHandle<TransparentPassEffectDesc>;
  /** Handle for the final compositing pass that outputs to screen. */
  private finalPass!: EffectHandle<FinalCopyEffectDesc>;

  /** The render pass orchestrator that manages the post-processing effect pipeline. */
  private renderPassOrchestrator: RenderPassOrchestrator;

  private _scenes: Scenes;

  private _core: Core | undefined;
  private _fontManager = new FontManager(FontWorkerURL);
  private _options: Options;
  private _stats: RendererStats | undefined;
  private _eventDisposer: (() => void) | undefined;
  private _disposed = false;
  private _renderFlag: RenderFlag = {
    forceUpdate: false,
    animation: false,
  };
  /** Shared screen-space label declutterer for text/sprite features. */
  private _declutter = new DeclutterManager(wasmDeclutterKernel);
  /** Reusable Vector2 for the declutter pass's per-frame viewport query. */
  private _declutterSize = new Vector2();
  /** Pending follow-up frame for a throttled declutter pass or an active
   *  fade, with the delay it was scheduled at (so a shorter need preempts). */
  private _declutterRetry: ReturnType<typeof setTimeout> | undefined;
  private _declutterRetryDelay = 0;
  private _isIdle = false;
  private _uniforms: CommonUniforms;
  /** Pending `flyTo` promises keyed by flight id, settled by
   *  `camera_flight_ended` events from the engine. */
  private _pendingFlights = new Map<number, (completed: boolean) => void>();

  /** Currently hovered feature, used to diff-synthesize hover events. */
  private _hoveredFeature: Nullable<PickedFeature> = null;

  private _meshes: MeshCache = new Map();
  private _abortControllers: AbortControllers = new Map();
  private _workerPoolPromises: WorkerPoolPromises = new Map();
  private _loadedTexs = new Map<string, Texture>();
  private _texturizedSceneByTileCoordinates: TexturizedSceneByTileCoordinates;
  private _tileTextureCompositor!: TileTextureCompositor;
  private _tileMapByHandle: TileMapByHandle = new Map();
  // fragment id → Set of {tileMesh, slotIndex}
  private _textureFragmentIndex: Map<string, Set<TextureSlot>> = new Map<
    string,
    Set<TextureSlot>
  >();
  // tileMesh → Set of fragment IDs it uses
  private _tileMeshToFragmentIds: Map<TileMesh, Set<string>> = new Map<
    TileMesh,
    Set<string>
  >();
  // Hillshade processing context
  // Scoped to this view instance to prevent cross-view contamination
  private _hillshadeContext = new HillshadeContext();
  private _initialized = false;

  /**
   * JS-side store for buffers WASM tracks by byte count only (`External`
   * entries). Fetched MVT pbf and worker-built geometry live here instead of
   * being copied into WASM linear memory, whose peak never shrinks. The
   * `_buf` wrapper prefers this store, falling back to WASM for entries Rust
   * still owns; handles are evicted per frame via `drainRemovedExternalHandles`.
   */
  private _inMemoryBufferStore = new InMemoryBufferStore();

  private _buf: BufferLoader = {
    // Getters prefer the JS store (type-matched) and fall back to the WASM
    // view for entries Rust still owns.
    u8: (handle) => {
      const js = this._inMemoryBufferStore.get(handle);
      if (js instanceof Uint8Array) return js;
      const b = this._core?.getBufferU8(handle);
      return b ?? null;
    },
    f32: (handle) => {
      const js = this._inMemoryBufferStore.get(handle);
      if (js instanceof Float32Array) return js;
      const b = this._core?.getBufferF32(handle);
      return b ?? null;
    },
    f64: (handle) => {
      const js = this._inMemoryBufferStore.get(handle);
      if (js instanceof Float64Array) return js;
      const b = this._core?.getBufferF64(handle);
      return b ?? null;
    },
    u32: (handle) => {
      const js = this._inMemoryBufferStore.get(handle);
      if (js instanceof Uint32Array) return js;
      const b = this._core?.getBufferU32(handle);
      return b ?? null;
    },
    // remove* take from the JS store when present (and clear the WASM-side
    // External accounting), else fall back to the owned-copy WASM remover.
    removeU8: (handle) => {
      const js = this._inMemoryBufferStore.take(handle);
      if (js instanceof Uint8Array) {
        this._core?.removeBuffer(handle);
        return js;
      }
      const b = this._core?.removeBufferU8(handle);
      return b ?? null;
    },
    removeU32: (handle) => {
      const js = this._inMemoryBufferStore.take(handle);
      if (js instanceof Uint32Array) {
        this._core?.removeBuffer(handle);
        return js;
      }
      const b = this._core?.removeBufferU32(handle);
      return b ?? null;
    },
    removeF32: (handle) => {
      const js = this._inMemoryBufferStore.take(handle);
      if (js instanceof Float32Array) {
        this._core?.removeBuffer(handle);
        return js;
      }
      const b = this._core?.removeBufferF32(handle);
      return b ?? null;
    },
    removeF64: (handle) => {
      const js = this._inMemoryBufferStore.take(handle);
      if (js instanceof Float64Array) {
        this._core?.removeBuffer(handle);
        return js;
      }
      const b = this._core?.removeBufferF64(handle);
      return b ?? null;
    },
    setU8: (handle: number, bits: bigint, b: Uint8Array) => {
      if (!this._core?.hasDataRequester(bits)) {
        return;
      }
      this._core?.setBufferU8(handle, bits, b.length, (buf: Uint8Array) => {
        buf.set(b);
      });
    },
    newU8: (b: Uint8Array) => {
      return this._core?.newBufferU8(b.length, (buf: Uint8Array) => {
        buf.set(b);
      });
      // return this._core?.newBufferU8Cloned(b);
    },
    newU32: (b: Uint32Array) => {
      return this._core?.newBufferU32(b.length, (buf: Uint32Array) => {
        buf.set(b);
      });
      // return this._core?.newBufferU32Cloned(b);
    },
    newF32: (b: Float32Array) => {
      return this._core?.newBufferF32(b.length, (buf: Float32Array) => {
        buf.set(b);
      });
      // return this._core?.newBufferF32Cloned(b);
    },
    newF64: (b: Float64Array) => {
      return this._core?.newBufferF64(b.length, (buf: Float64Array) => {
        buf.set(b);
      });
      // return this._core?.newBufferF32Cloned(b);
    },
    // adopt* register a JS-owned array (zero-copy) and mint a byte-count-only
    // External handle; the array bytes never touch WASM linear memory.
    adoptU8: (array: Uint8Array) => {
      const handle = this._core?.newExternalBuffer(array.byteLength);
      if (handle != null) this._inMemoryBufferStore.set(handle, array);
      return handle;
    },
    adoptU32: (array: Uint32Array) => {
      const handle = this._core?.newExternalBuffer(array.byteLength);
      if (handle != null) this._inMemoryBufferStore.set(handle, array);
      return handle;
    },
    adoptF32: (array: Float32Array) => {
      const handle = this._core?.newExternalBuffer(array.byteLength);
      if (handle != null) this._inMemoryBufferStore.set(handle, array);
      return handle;
    },
    adoptF64: (array: Float64Array) => {
      const handle = this._core?.newExternalBuffer(array.byteLength);
      if (handle != null) this._inMemoryBufferStore.set(handle, array);
      return handle;
    },
    setExternal: (handle: number, bits: bigint, array: Uint8Array) => {
      if (!this._core?.hasDataRequester(bits)) {
        return;
      }
      this._core.setExternalBuffer(handle, bits, array.byteLength);
      this._inMemoryBufferStore.set(handle, array);
    },
    remove: (handle: number) => {
      // Also drop any JS-side entry so the two stores stay in step when a
      // caller removes an External handle without going through remove*.
      this._inMemoryBufferStore.delete(handle);
      this._core?.removeBuffer(handle);
    },
    drainRemovedExternalHandles: () => {
      const handles = this._core?.drainRemovedExternalHandles();
      if (!handles) return;
      for (const handle of handles) {
        this._inMemoryBufferStore.delete(handle);
      }
    },
    triggerDataRequesterLoaded: (bits: bigint, handle: number) => {
      this._core?.triggerDataRequesterLoaded(bits, handle);
    },
    triggerDataRequesterFailed: (bits: bigint) => {
      this._core?.triggerDataRequesterFailed(bits);
    },
  };
  private _texFragment: TextureFragmentHandler = {
    triggerTextureFragmentLoaded: (
      bits: bigint,
      status: TextureFragmentStatus,
    ) => {
      this._core?.triggerTextureFragmentLoaded(bits, status);
    },
  };
  // Per-frame snapshot of the WASM vector resolution revision, refreshed in `_render`.
  private _vectorRevision = 0;
  // Per-frame snapshot of the WASM raster drape resolution revision, refreshed in `_render`.
  private _rasterRevision = 0;
  private _tileHandler: TileHandler = createTileHandler({
    getCore: () => this._core,
    getVectorRevision: () => this._vectorRevision,
    getRasterRevision: () => this._rasterRevision,
  });
  private _globeHandler: GlobeHandler = {
    getTransparent: () => {
      return this._core?.getGlobeTransparent();
    },
    getMaxSse: () => {
      return this._core?.getGlobeMaxSse();
    },
    getSegments: () => {
      return this._core?.getGlobeSegments();
    },
    getColor: (): CoreColor | undefined => {
      const hexColor = this._core?.getGlobeColor();
      return hexColor === undefined ? undefined : new Color().setHex(hexColor);
    },
    getHideUnderground: () => {
      return this._core?.getGlobeHideUnderground();
    },
    getUseNormal: () => {
      return this._core?.getGlobeUseNormal();
    },
    getOpacity: () => {
      return this._core?.getGlobeOpacity();
    },
    getWireframe: () => {
      return this._core?.getGlobeWireframe();
    },
    getElevationColormap: () => {
      return this._core?.getGlobeElevationColormap();
    },
    setTransparent: (value: boolean) => {
      this._core?.setGlobeTransparent(value);
    },
    setMaxSse: (value: number) => {
      this._core?.setGlobeMaxSse(value);
    },
    setSegments: (value: number) => {
      this._core?.setGlobeSegments(value);
    },
    setColor: (value: CoreColor) => {
      this._core?.setGlobeColor(value.toHex());
    },
    setHideUnderground: (value: boolean) => {
      this._core?.setGlobeHideUnderground(value);
    },
    setUseNormal: (value: boolean) => {
      this._core?.setGlobeUseNormal(value);
    },
    setOpacity: (value: number) => {
      this._core?.setGlobeOpacity(value);
    },
    setWireframe: (value: boolean) => {
      this._core?.setGlobeWireframe(value);
    },
    setElevationColormap: (value: ColorMap) => {
      this._core?.setGlobeElevationColormap(value.flatten());

      const canvas = value.createImage();
      const texture = new Texture(canvas);
      texture.wrapS = ClampToEdgeWrapping;
      texture.wrapT = ClampToEdgeWrapping;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.needsUpdate = true;

      this._uniforms.colorMapTexture.value = texture;

      // Track additional texture usage
      this._defaultTextureOptions.additionalTexturesInUse = {
        ...this._defaultTextureOptions.additionalTexturesInUse,
        colorMapTexture: true,
      };
    },
  };
  private _workerTaskHandler: WorkerTaskHandler = {
    triggerWorkerTaskCompleted: (bits, result) => {
      this._core?.triggerWorkerTaskCompleted(bits, result);
    },
    triggerWorkerTaskFailed: (delegator_id) => {
      if (this._core) {
        this._core.triggerWorkerTaskFailed(delegator_id);
      } else {
        // The engine is gone (teardown); still free the boundary object.
        delegator_id.free();
      }
    },
    hasWorkerTask: (bits) => {
      return !!this._core?.hasWorkerTask(bits);
    },
  };
  private _featureHandler: FeatureHandler = {
    getTransferablePolygonBatchedFeature: (bits) => {
      return this._core?.getTransferablePolygonBatchedFeature(bits);
    },
    getTransferablePolylineBatchedFeature: (bits) => {
      return this._core?.getTransferablePolylineBatchedFeature(bits);
    },
    markFeatureIsRendered: (type, bits) => {
      this._core?.markFeatureIsRendered(type, bits);
    },
    reportFeatureGpuBytes: (bits, bytes) => {
      this._core?.reportFeatureGpuBytes(bits, bytes);
    },
    readAllBatchedProperties: (featureId, f) =>
      this._core?.readAllBatchedProperties(featureId, f),
    readFilteredBatchedProperties: (featureId, keys, f) =>
      this._core?.readFilteredBatchedProperties(featureId, keys, f),
  };
  private _meshHandler: MeshHandler = {
    setTileMeshPrepared: (handle: bigint) => {
      this._core?.setTileMeshPrepared(handle);
    },
  };
  private _layerHandler: LayerHandler = {
    getLayerIndex: (layerId: string) => {
      return this._core?.getLayerIndex(layerId);
    },
  };
  private _ownedRootElement: HTMLElement | undefined;
  private _eventManager = new EventManager();
  private _pickHelper?: PickHelper;
  private _terrainPicker: TerrainPicker;
  private _defaultTextureOptions: TextureOptions;
  private layersManager = new LayersManager();
  private shadowMapViewers: ShadowMapViewers;
  private eventContext!: EventContext;

  // Registry support
  private registries!: Registries;
  private viewContext!: ViewContext;
  private plugins: Plugin[] = [];

  /** Built-in attribution UI; unset when disabled or in a worker (no DOM). */
  private _attribution?: AttributionPlugin;

  /**
   * Derived G-buffer attachment configuration — the union of the
   * `requiredBuffers` declared by the active effects.
   */
  private _buffers: ResolvedGBufferOptions;

  /** Scene-level default of the `lit` material option (see {@link lit}). */
  private _lit = true;

  private pixelRatioMatchedMedia?: MediaQueryList;

  private fixedGpuBytesReportScheduled = false;
  private fixedGpuBytesResyncPending = false;
  private framesSinceFixedGpuBytesReport = 0;
  private lastReportedFixedGpuBytes = -1;

  /**
   * The built-in attribution (credit) UI. `undefined` when disabled via
   * `defaultAttribution: false`, or in a worker / no-DOM environment. Feed it
   * credits with `view.attribution?.add([...])`.
   */
  get attribution(): AttributionPlugin | undefined {
    return this._attribution;
  }

  /**
   * Buffers currently allocated. Not configurable — derived as the union of
   * the active effects' `requiredBuffers`. All but `globeNormal` are G-buffer
   * attachments.
   */
  get buffers(): ResolvedGBufferOptions {
    return this._buffers;
  }

  /**
   * Scene-level default of the `lit` material option. `false` makes every
   * material without an explicit `lit` output plain albedo, while normals and
   * the shadow G-buffer keep being written – the input for deferred lighting.
   * Toggling recompiles the affected shaders once.
   * @defaultValue true
   */
  get lit(): boolean {
    return this._lit;
  }

  set lit(value: boolean) {
    if (this._lit === value) return;
    this._lit = value;
    this.viewContext._setLit(value);
    this.forceUpdate();
  }

  constructor(options: Options = {}) {
    super();

    // Patches the global ShaderLib, but the injected source is
    // view-independent (defines carry the layout). Here rather than at module
    // import so importing the library has no side effects.
    overrideMaterialsForMRT();

    this._buffers = resolveGBufferOptions();

    if (!options.canvas) {
      const div = document.createElement("div");
      div.id = "navara-root";
      div.style.width = "100vw";
      div.style.height = "100vh";

      options.canvas = document.createElement("canvas");
      options.canvas.id = "navara-canvas";
      options.canvas.style.width = "100%";
      options.canvas.style.height = "100%";

      div.appendChild(options.canvas);

      document.body.appendChild(div);
      this._ownedRootElement = div;
    }

    this._options = options;

    // Attribution UI on by default; skip in a worker (no DOM) or when disabled.
    if (options.defaultAttribution !== false && !isWorker()) {
      const cfg =
        typeof options.defaultAttribution === "object"
          ? options.defaultAttribution
          : undefined;
      this._attribution = new AttributionPlugin(cfg);
      this.addPlugin(this._attribution);
    }

    // Initialize terrain picker
    this._terrainPicker = new TerrainPicker();

    // disable right-click
    options.canvas?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    const renderer = new WebGLRenderer({
      // If it's true, some noise will happen. So use other AA algorithm instead.
      antialias: (options.multisampling ?? 0) > 0,
      logarithmicDepthBuffer: options.logarithmicDepthBuffer ?? true,
      canvas: options.canvas,
      stencil: true,
    });
    renderer.info.autoReset = false;
    renderer.autoClearStencil = false;
    renderer.autoClearColor = false;
    renderer.autoClearDepth = false;

    this._renderer = renderer;

    renderer.shadowMap.enabled = !!options.shadow;
    this._renderer.shadowMap.type = PCFShadowMap;

    // Update shadow map manually in CustomRenderPass.
    renderer.shadowMap.autoUpdate = false;

    const { width, height } = this._getCanvasSize() ?? {};
    invariant(width && height);

    if (typeof options?.pixelRatio === "number" || !isWorker()) {
      const pixelRatio = isWorker()
        ? 1
        : getDevicePixelRatio({
            override: options.pixelRatio,
            mobileOptimization: options.mobileOptimization,
          });
      renderer.setPixelRatio(pixelRatio);
    }

    renderer.setSize(width, height, !isWorker());
    if (options.container) {
      options.container.appendChild(renderer.domElement);
    }

    this._texturizedSceneByTileCoordinates =
      new TexturizedSceneByTileCoordinates(this._renderer);

    // Compositor owns the per-tile composite atlas pool. It centralises the
    // vector-scene offscreen render loop that previously lived in TileMesh,
    // and is the seam through which a future MRT composite pass will reduce
    // the main TileMesh shader's texture fetches.
    // Atlas / drape RT side length is 512² on both desktop and mobile — the
    // SAME source of truth `getDefaultMemoryCostHints` uses, so the ledger's
    // per-tile GPU estimate matches the real allocation.
    // `isMobileOptimized()` only reads `_options.mobileOptimization` (set
    // above) and the pure `isMobileDevice()`, so it is safe here in the ctor.
    this._tileTextureCompositor = new TileTextureCompositor({
      renderer: this._renderer,
      texturizedSceneByTileCoordinates: this._texturizedSceneByTileCoordinates,
      mercatorY: this._tileHandler.mercatorY,
      size: getCompositeAtlasSize(this.isMobileOptimized()),
    });

    this._scenes = {
      light: new Group(),
      mrt: new Scene(),
      globe: new Scene(),
      draped: new Scene(),
      opaque: new Scene(),
      transparent: new Scene(),
      skyEnvMap: new Scene(),
    };

    this._camera = new ThreeViewCamera();

    // Setup render pass orchestrator
    this.renderPassOrchestrator = new RenderPassOrchestrator(this._renderer, {
      halfFloat: options.halfFloat ?? true,
      multisampling: options.multisampling,
    });

    this.renderPassOrchestrator.setSize(width, height);
    this.renderPassOrchestrator.onPassesChanged = () =>
      this._scheduleFixedGpuBytesReport();

    // Background color
    const bgColor = options.backgroundColor
      ? options.backgroundColor.toHex()
      : 0x000000;
    this._renderer.setClearColor(bgColor);

    if (!options.disableAutoResize && !isWorker()) {
      window.addEventListener("resize", this._handleResize);
      // Observe a change in devicePixelRatio.
      this.pixelRatioMatchedMedia = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`,
      );

      this.pixelRatioMatchedMedia.addEventListener(
        "change",
        this._handleResize,
      );
    }

    if (options.debug) {
      const t = options.container || this._renderer.domElement.parentElement;
      if (t) {
        this._stats = new RendererStats(
          {
            beginRender: () => this._renderer.info.reset(),
            endRender: () => ({
              ...this._renderer.info.render,
              memGeometries: this._renderer.info.memory.geometries,
            }),
          },
          () => {
            const stats = this._core?.getMemoryStats();
            // Read the fields off the boxed wasm-bindgen struct, then free it —
            // the sampler runs ~1/s and the struct otherwise leaks until the
            // FinalizationRegistry runs (see fontWorker.ts for the pattern).
            const bufferTotalBytes = stats?.bufferTotalBytes;
            const externalBufferBytes = stats?.externalBufferBytes;
            const budgetBytes = stats?.budgetBytes;
            stats?.free();
            const memory = (
              performance as Performance & {
                memory?: { usedJSHeapSize: number };
              }
            ).memory;
            const MB = 1024 * 1024;
            return {
              wasmMB:
                bufferTotalBytes !== undefined
                  ? bufferTotalBytes / MB
                  : undefined,
              jsBufMB:
                externalBufferBytes !== undefined
                  ? externalBufferBytes / MB
                  : undefined,
              jsHeapMB: memory ? memory.usedJSHeapSize / MB : undefined,
              budgetMB:
                budgetBytes !== undefined ? budgetBytes / MB : undefined,
            };
          },
        );
        t.appendChild(this._stats.dom);
      }
    }

    this._uniforms = {
      viewportAndPixelRatio: { value: null },
      frustumNearFar: { value: null },
      frustumRatio: { value: null },
      tGlobeDepth: { value: null },
      tGlobeNormal: { value: null },
      tSkyEnvMap: { value: null },
      inverseProjectionMatrix: { value: null },
      // Vertical fov in radians; synced with the engine on each frustum event.
      // Plain arithmetic: the WASM-backed degreeToRadian is not available
      // until init().
      fov: { value: (this._camera.raw.fov * Math.PI) / 180 },
      screenHeightPx: { value: height },
      time: { value: 0 },
      colorMapTexture: { value: null },
      waterTexture: { value: null },
    };

    // This is necessary to avoid attaching a texture beyond the max textures capabilities of GPU.
    // TODO: Allow to change this value dynamically.
    const NUM_CASCADED_SHADOW_MAPS = 6;

    this._defaultTextureOptions = {
      maxAnisotropy: this._renderer.capabilities.getMaxAnisotropy(),
      magFilter: LinearFilter,
      minFilter: LinearFilter,
      useMipmaps: true,
      maxTextures:
        Math.max(this._renderer.capabilities.maxTextures, 8) -
        NUM_CASCADED_SHADOW_MAPS,
    };

    // Load shared water texture if enabled
    if (options.waterTexture?.enabled) {
      const waterUrl = options.waterTexture.url ?? WATER_NORMAL_URL;
      this._uniforms.waterTexture.value = TEXTURE_LOADER.load(
        waterUrl,
        (texture) => {
          texture.wrapS = RepeatWrapping;
          texture.wrapT = RepeatWrapping;
        },
      );
      // Track additional texture usage
      this._defaultTextureOptions.additionalTexturesInUse = {
        ...this._defaultTextureOptions.additionalTexturesInUse,
        waterTexture: true,
      };
    }

    this._atmosphere = new Atmosphere(
      this._renderer,
      options.atmosphere,
      this._camera,
    );
    this._atmosphere.on("needsUpdate", this.forceUpdate);
    // Textures load lazily, kicked off by the first consumer registering via
    // onTexturesReady(); re-render whenever they arrive.
    this._atmosphere.on("textureLoaded", this.forceUpdate);

    this.on("layer", (e, id, ...args) => {
      this.layersManager.emitById(e, id, ...args);
    });

    this._renderFlag.animation = !!options.animation;

    this._camera.on("frustumChanged", () => {
      this.renderPassOrchestrator.effectComposer.setMainCamera(
        this._camera.raw,
      );
    });

    this.shadowMapViewers = new ShadowMapViewers(this._scenes.light);
  }

  /**
   * Extend a pointer event with map coordinates at its location
   */
  private convertToMapEvent(event: PointerEvent): MapPointerEvent | null {
    const rect = this._renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const xyz = convertScreenPos(this, x, y);

    if (xyz) {
      return Object.assign(event, {
        map: {
          x: xyz.x,
          y: xyz.y,
          z: xyz.z,
        },
      });
    }

    return null;
  }

  private initializeRenderPass() {
    this.skyEnvMap = this.addEffect<SkyEnvMapEffectDesc>({
      skyEnvMap: {},
    });
    this.mrtPass = this.addEffect<MRTPassEffectDesc>({
      mrt: {
        // debugNormal: true,
      },
    });
    this.transparentPass = this.addEffect<TransparentPassEffectDesc>({
      transparent: {},
    });
    this.finalPass = this.addEffect<FinalCopyEffectDesc>({
      final: {},
    });
  }

  private get renderPass() {
    const instance = this.mrtPass.ref.raw;
    invariant(instance);
    return instance;
  }

  /** The camera controller that manages view position, orientation, and projection. */
  get camera(): ThreeViewCamera {
    return this._camera;
  }

  /** The globe instance that manages terrain, imagery layers, and globe-specific settings. */
  get globe(): Globe {
    return this._globe;
  }

  /** The atmosphere renderer that handles sky, sun, and atmospheric scattering effects. */
  get atmosphere(): Atmosphere {
    return this._atmosphere;
  }

  /**
   * Gets the tone mapping exposure value.
   */
  get toneMappingExposure() {
    return this._renderer.toneMappingExposure;
  }
  /**
   * Sets the tone mapping exposure value for HDR rendering.
   */
  set toneMappingExposure(v: number) {
    this._renderer.toneMappingExposure = v;
    this.forceUpdate();
  }

  /**
   * The resolved tile-cache memory budget in bytes (see `Options.cacheBytes`).
   * `undefined` before `init()` when no explicit option was given.
   */
  get cacheBytes(): number | undefined {
    return this._options.cacheBytes;
  }
  /**
   * Updates the tile-cache memory budget at runtime. Lowering it evicts
   * retained tiles down to the new budget over the next frames. Passing
   * `undefined` disables budgeting entirely, restoring the original
   * destroy-on-unvisited tile lifecycle.
   */
  set cacheBytes(v: number | undefined) {
    this._options.cacheBytes = v;
    this._core?.setCacheBytes(v);
  }

  /**
   * The resolved LOD fog settings (see `Options.lodFog`). `undefined`
   * before `init()`.
   */
  get lodFog(): LodFogSettings | undefined {
    const lodFog = this._options.lodFog;
    if (!lodFog) return undefined;
    return lodFog as LodFogSettings;
  }
  /**
   * Updates the LOD fog at runtime; partial values merge over the current
   * settings. The next traversal re-selects tile LODs with the new curve.
   */
  set lodFog(v: Partial<LodFogSettings>) {
    const lodFog = {
      ...getDefaultLodFog({ isMobile: this.isMobileOptimized() }),
      ...this._options.lodFog,
      ...v,
    };
    this._options.lodFog = lodFog;
    this._core?.setLodFog(lodFog.enabled, lodFog.density, lodFog.sseFactor);
  }

  /**
   * The resolved dynamic-SSE settings (see `Options.dynamicSse`).
   * `undefined` before `init()`.
   */
  get dynamicSse(): DynamicSseSettings | undefined {
    const dynamicSse = this._options.dynamicSse;
    if (!dynamicSse) return undefined;
    return dynamicSse as DynamicSseSettings;
  }
  /**
   * Updates the dynamic SSE at runtime; partial values merge over the
   * current settings. The next traversal re-selects tile LODs with the new
   * curve.
   */
  set dynamicSse(v: Partial<DynamicSseSettings>) {
    const dynamicSse = {
      ...getDefaultDynamicSse(),
      ...this._options.dynamicSse,
      ...v,
    };
    this._options.dynamicSse = dynamicSse;
    // The WASM class is constructed internally and consumed (moved) by
    // `setDynamicSse`, so no `.free()` is needed — per the WASM API policy.
    this._core?.setDynamicSse(
      new EngineDynamicSse(
        dynamicSse.enabled,
        dynamicSse.density,
        dynamicSse.sseFactor,
        dynamicSse.heightFalloff,
        dynamicSse.minHeight,
        dynamicSse.maxHeight,
      ),
    );
  }

  /**
   * Updates the memory-pressure SSE degrade range at runtime. `min` is the
   * resting multiplier applied even without budget pressure (> 1 coarsens far
   * tiles at rest); `max` is the ceiling the dynamic degrade can climb to. The
   * next traversal re-selects tile LODs with the new range.
   */
  setSseMultiplierRange(min: number, max: number): void {
    this._options.memoryBudget = {
      ...this._options.memoryBudget,
      sseMultiplierMin: min,
      sseMultiplierMax: max,
    };
    this._core?.setSseMultiplierRange(min, max);
  }

  /**
   * Snapshot of engine memory usage (WASM buffer bytes, GPU estimates,
   * retained tile counts). Returns `undefined` before `init()`.
   */
  memoryStats(): MemoryStats | undefined {
    const stats = this._core?.getMemoryStats();
    if (!stats) return undefined;
    // Copy every field into a plain object and free the boxed WASM struct
    // before returning — the public API must not expose wasm-bindgen classes
    // (WASM_API_POLICY.md), and returning the class would also leak it.
    const plain: MemoryStats = {
      bufferTotalBytes: stats.bufferTotalBytes,
      externalBufferBytes: stats.externalBufferBytes,
      bufferCount: stats.bufferCount,
      gpuBytesEst: stats.gpuBytesEst,
      externalCpuBytes: stats.externalCpuBytes,
      reservedBytes: stats.reservedBytes,
      fixedGpuBytes: stats.fixedGpuBytes,
      budgetBytes: stats.budgetBytes,
      evictedCount: stats.evictedCount,
      sseMultiplier: stats.sseMultiplier,
      retainedVector: stats.retainedVector,
      retainedTerrain: stats.retainedTerrain,
      retainedRaster: stats.retainedRaster,
      retainedTiles3d: stats.retainedTiles3d,
    };
    stats.free();
    return plain;
  }

  /**
   * Snapshot of worker-side memory: per-tile-worker WASM heaps (point-in-time
   * samples from the pool's post-task probes — this call also requests fresh
   * probes, whose results show up on the *next* call) and the font worker's
   * heap/cache breakdown (`undefined` while no font has been used). Returns
   * `undefined` before `init()`.
   */
  async workerMemoryStats(): Promise<WorkerMemoryStats | undefined> {
    if (!this._initialized) return undefined;
    // Request fresh samples for the next read; probes coalesce per worker.
    probeWorkerPoolHeap();
    return {
      tileWorkers: workerPoolHeapStats(),
      fontWorker: await this._fontManager.memoryStats(),
    };
  }

  private get globeDepthTexture() {
    return this.renderPass.globeDepthCopyPass.texture;
  }

  private get depthTexture() {
    return this.renderPass.allDepthCopyPass.texture;
  }

  /**
   * Returns whether mobile optimizations should be applied.
   * If `mobileOptimization` option is explicitly set, returns that value;
   * otherwise falls back to auto-detecting via `isMobileDevice()`.
   */
  isMobileOptimized(): boolean {
    const opt = this._options.mobileOptimization;
    return opt ?? isMobileDevice();
  }

  /**
   * Forces an immediate re-render of the scene on the next frame.
   */
  forceUpdate = () => {
    this._renderFlag.forceUpdate = true;
  };

  /**
   * Initializes the 3D engine, WASM modules, and starts the main render loop.
   * Must be called before using the view.
   */
  async init() {
    if (this._core || this._initialized) return;

    this._initialized = true;

    const mobileOptimized = this.isMobileOptimized();
    const concurrencyManager = createDefaultConcurrencyManager(mobileOptimized);
    if (mobileOptimized) {
      this._hillshadeContext.normalMapScale = 0.5;
    }

    // One device-wide view of memory: the main-thread tile cache, the
    // tile-worker pool, and the font worker derive their budgets together.
    const budgets = getDefaultMemoryBudgets({
      isMobile: mobileOptimized,
      poolSize: concurrencyManager.total,
    });

    initializeWorkerPool(WorkerURL, concurrencyManager, {
      // A worker over this WASM heap budget is recycled; tighter on mobile,
      // where the process is killed at much lower memory pressure.
      maxWorkerHeapBytes:
        this._options.memoryBudget?.maxWorkerHeapBytes ??
        budgets.maxWorkerHeapBytes,
    });

    // Fetch WASM resources. Atmosphere textures are not fetched here: they
    // load lazily once a consumer (sky, sun light, aerial perspective, ...)
    // registers via atmosphere.onTexturesReady().
    await Promise.all([initCore(), initNavaraApi()]);

    this._core = new Core(newId());
    this._core.start();

    const cacheBytes = this._options.cacheBytes ?? budgets.cacheBytes;
    this._options.cacheBytes = cacheBytes;
    this._core.setCacheBytes(cacheBytes);

    // Cap in-flight fetches (per tile pipeline) — mobile presets shrink the
    // decode/upload burst a camera move can produce.
    this._core.setMaxPendingRequests(
      this._options.memoryBudget?.maxPendingRequests ??
        budgets.maxPendingRequests,
    );

    // Memory-pressure SSE degrade range. min > 1 (mobile) keeps far tiles
    // coarser at rest; max is the ceiling the dynamic degrade can climb to
    // when the visible set alone exceeds the budget.
    this._core.setSseMultiplierRange(
      this._options.memoryBudget?.sseMultiplierMin ?? budgets.sseMultiplierMin,
      this._options.memoryBudget?.sseMultiplierMax ?? budgets.sseMultiplierMax,
    );

    // Override the Rust CostHints defaults with sizes derived from this
    // device's actual composite-atlas dimensions (512² with three MRT
    // attachments, ~3MB per tile) so the ledger's per-tile GPU estimate matches.
    const costHints = getDefaultMemoryCostHints({ isMobile: mobileOptimized });
    this._core.setMemoryCostHints(
      costHints.atlasTileBytes,
      costHints.rasterTileBytes,
    );

    // Passes added before `_core` existed could not be reported; sync the
    // fixed render-target footprint now that the ledger is reachable.
    this._scheduleFixedGpuBytesReport();

    // LOD fog: stronger distance-based degrade on low-memory devices.
    const lodFog = {
      ...getDefaultLodFog({ isMobile: mobileOptimized }),
      ...this._options.lodFog,
    };
    this._options.lodFog = lodFog;
    this._core.setLodFog(lodFog.enabled, lodFog.density, lodFog.sseFactor);

    // Dynamic SSE: tilt-scaled relaxation for street-level horizon views.
    const dynamicSse = {
      ...getDefaultDynamicSse(),
      ...this._options.dynamicSse,
    };
    this._options.dynamicSse = dynamicSse;
    this._core.setDynamicSse(
      new EngineDynamicSse(
        dynamicSse.enabled,
        dynamicSse.density,
        dynamicSse.sseFactor,
        dynamicSse.heightFalloff,
        dynamicSse.minHeight,
        dynamicSse.maxHeight,
      ),
    );

    this._fontManager.setConcurrencyManager(concurrencyManager);
    this._fontManager.setMemoryBudget(
      this._options.memoryBudget?.fontBudgetBytes ?? budgets.fontBudgetBytes,
    );

    this._globe = new Globe(this._globeHandler, this._options);

    // Set up Registry
    this.viewContext = new ViewContext(
      this._scenes,
      this.layersManager,
      this.renderPassOrchestrator,
      concurrencyManager,
      this._core,
      this._meshes,
    );
    this.registries = new Registries(this, this.viewContext);
    this.viewContext.on("meshPassKeyChanged", this._syncGBuffers);
    this.viewContext._setRegistries(this.registries);
    this.eventContext = new EventContext({
      eventManager: this._eventManager,
      scenes: this._scenes,
      camera: this._camera,
      meshes: this._meshes,
      abortControllers: this._abortControllers,
      buf: this._buf,
      texFragment: this._texFragment,
      tileHandler: this._tileHandler,
      workerTaskHandler: this._workerTaskHandler,
      meshHandler: this._meshHandler,
      featureHandler: this._featureHandler,
      loadedTexs: this._loadedTexs,
      workerPoolPromises: this._workerPoolPromises,
      uniforms: this._uniforms,
      texturizedSceneByTileCoordinates: this._texturizedSceneByTileCoordinates,
      tileTextureCompositor: this._tileTextureCompositor,
      tileMapByHandle: this._tileMapByHandle,
      textureOptions: this._defaultTextureOptions,
      renderFlag: this._renderFlag,
      viewEvents: this,
      layersManager: this.layersManager,
      viewContext: this.viewContext,
      flightHandler: (id, completed) => {
        const resolve = this._pendingFlights.get(id);
        if (resolve) {
          this._pendingFlights.delete(id);
          resolve(completed);
        }
      },
      layerHandler: this._layerHandler,
      fontManager: this._fontManager,
      textureFragmentIndex: this._textureFragmentIndex,
      tileMeshToFragmentIds: this._tileMeshToFragmentIds,
      hillshadeContext: this._hillshadeContext,
      declutter: this._declutter,
    });

    // Register built-in descriptors
    this.registerBuiltIns();

    if (!isWorker()) {
      this._eventDisposer = registerInputEvents(
        this._core,
        this._renderer.domElement,
        () => {
          const el = this._renderer.domElement;
          const rect = el.getBoundingClientRect();
          const pos = this.pickDepthPosition(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          if (!pos) return null;
          return this._camera.raw.position.distanceTo(pos);
        },
      );
      this._pickHelper = new PickHelper(
        this._renderer.domElement,
        this._renderer,
        this._camera.raw,
        this._meshes,
        this.onPick.bind(this),
        this.onHoverPick.bind(this),
        // Picks cost a GPU render (plus a re-render to restore draped
        // atlases), so both gestures stay off until someone actually
        // listens for the result.
        () => !!this.size("featureClick"),
        () =>
          !!(
            this.size("featureHover") ||
            this.size("featureEnter") ||
            this.size("featureLeave")
          ),
        // {
        //   debug: true,
        // },
      );
      this._pickHelper.enablePick(this._options.picking ?? true);
    }

    this.initializeRenderPass();

    this.viewContext._setRenderPass(this.renderPass);

    // Warm up workers. Non-blocking: warms one worker, the rest follow
    // in the background off the HTTP cache; tasks dispatched to a still-cold
    // worker just await WASM inside the task.
    warmUpWorkerPool().catch((e) =>
      console.error("Failed to warm up the worker pool:", e),
    );

    await Promise.all(this.plugins.map((p) => p.init(this, this.viewContext)));

    this._startMainLoop();

    const size = new Vector2();
    this._renderer.getSize(size);
    this.resize(size.width, size.height, this._renderer.getPixelRatio());

    this._camera.core = this._core;

    // The map events are fed from pointer events; touch produces no
    // compatibility mouse events because the camera-input handlers call
    // preventDefault() on touch events. `click` is a gesture, not the DOM
    // event: a primary-pointer press and release within the travel
    // tolerance, with no pinch and no cancellation. Camera drags never
    // fire it.
    let clickStart: Vector2 | undefined;

    this._renderer.domElement.addEventListener("pointerdown", (event) => {
      // A second finger turns the gesture into a pinch, not a tap.
      clickStart =
        event.isPrimary && event.button === 0
          ? new Vector2(event.clientX, event.clientY)
          : undefined;
      const mapEvent = this.convertToMapEvent(event);
      if (mapEvent) {
        this.emit("pointerdown", mapEvent);
      }
    });

    this._renderer.domElement.addEventListener("pointerenter", (event) => {
      const mapEvent = this.convertToMapEvent(event);
      if (mapEvent) {
        this.emit("pointerenter", mapEvent);
      }
    });

    this._renderer.domElement.addEventListener("pointerleave", (event) => {
      const mapEvent = this.convertToMapEvent(event);
      if (mapEvent) {
        this.emit("pointerleave", mapEvent);
      }
    });

    this._renderer.domElement.addEventListener("pointermove", (event) => {
      const mapEvent = this.convertToMapEvent(event);
      if (mapEvent) {
        this.emit("pointermove", mapEvent);
      }
    });

    this._renderer.domElement.addEventListener("pointerup", (event) => {
      const mapEvent = this.convertToMapEvent(event);
      if (mapEvent) {
        this.emit("pointerup", mapEvent);
      }
      if (!event.isPrimary || event.button !== 0) return;
      const start = clickStart;
      clickStart = undefined;
      if (!start || !mapEvent) return;
      const tolerance =
        event.pointerType === "touch"
          ? TAP_PIXEL_TOLERANCE
          : CLICK_PIXEL_TOLERANCE;
      if (
        isClickGesture(
          start,
          new Vector2(event.clientX, event.clientY),
          tolerance,
        )
      ) {
        this.emit("click", mapEvent);
      }
    });

    this._renderer.domElement.addEventListener("pointercancel", (event) => {
      clickStart = undefined;
      this.emit("pointercancel", event);
    });
  }

  /**
   * Disposes all resources and stops the render loop.
   * Call this when the view is no longer needed.
   */
  dispose() {
    this._disposed = true;
    this._initialized = false;
    // Settle pending flyTo promises so callers never hang on a disposed view.
    for (const resolve of this._pendingFlights.values()) {
      resolve(false);
    }
    this._pendingFlights.clear();
    if (this._declutterRetry !== undefined) {
      clearTimeout(this._declutterRetry);
      this._declutterRetry = undefined;
    }
    // Dispose the view-owned attribution plugin (other plugins are the caller's).
    this._attribution?.dispose();
    this._attribution = undefined;
    if (!isWorker()) {
      window.removeEventListener("resize", this._handleResize);
      this.pixelRatioMatchedMedia?.removeEventListener(
        "change",
        this._handleResize,
      );
    }

    if (this._eventDisposer) {
      this._eventDisposer();
      this._eventDisposer = undefined;
    }

    if (this._pickHelper) {
      this._pickHelper.dispose();
      this._pickHelper = undefined;
    }

    if (this._terrainPicker) {
      this._terrainPicker.dispose();
    }

    this._fontManager.dispose();
    this._atmosphere._dispose();

    this.skyEnvMap?.delete();
    this.mrtPass?.delete();
    this.transparentPass?.delete();
    this.finalPass?.delete();

    // Abort all pending requests
    for (const controller of this._abortControllers.values()) {
      controller.abort();
    }
    this._abortControllers.clear();

    // Dispose loaded textures (closes any ImageBitmap backing so the decoded
    // pixels are freed, not just the GL texture).
    for (const tex of this._loadedTexs.values()) {
      disposeTexture(tex);
    }
    this._loadedTexs.clear();

    // Cleanup hillshade context (temp DEMs, generator, etc.)
    this._hillshadeContext.dispose();

    // Drop declutter participants so the manager doesn't retain removed
    // meshes' GPU/font resources past this view's lifetime.
    this._declutter.dispose();

    // Clear caches and maps
    this._meshes.clear();
    this._inMemoryBufferStore.clear();
    this._workerPoolPromises.clear();
    this._tileMapByHandle.clear();
    this._textureFragmentIndex.clear();
    this._tileMeshToFragmentIds.clear();

    // Dispose render pipeline GPU resources
    this.renderPassOrchestrator.dispose();

    // Release per-tile composite atlases, cached shader materials, placeholder
    // textures, and the fullscreen quad geometry owned by the compositor.
    this._tileTextureCompositor.dispose();

    // Clean up WASM core
    this._core?.free();
    this._core = undefined;

    if (this._stats) {
      this._stats.dom.remove();
      this._stats = undefined;
    }

    this._renderer.setAnimationLoop(null);
    if (
      "dispose" in this._renderer &&
      typeof this._renderer.dispose === "function"
    ) {
      this._renderer.dispose();
    }

    // Remove auto-created DOM container so a new ThreeView can append its own
    this._ownedRootElement?.remove();
    this._ownedRootElement = undefined;

    // Reset worker pool so a new ThreeView can reinitialize it
    terminateWorkerPool();
  }

  /**
   * Resizes the renderer and updates the camera aspect ratio.
   * @param width - New width in pixels (uses canvas size if omitted)
   * @param height - New height in pixels (uses canvas size if omitted)
   * @param pixelRatio - Device pixel ratio
   */
  resize = (width?: number, height?: number, pixelRatio?: number) => {
    if (this._disposed) return;

    const canvas = this._getCanvasSize();
    const w = typeof width === "number" ? width : canvas?.width;
    const h = typeof height === "number" ? height : canvas?.height;
    if (typeof w !== "number" || typeof h !== "number") return;

    this._camera.raw.aspect = w / h;
    this._camera.raw.updateProjectionMatrix();
    this._renderer.setSize(w, h, !isWorker());
    this.renderPassOrchestrator.setSize(w, h);
    if (this._options.pixelRatio == null && pixelRatio) {
      this._renderer.setPixelRatio(pixelRatio);
    }

    const drawingBufferSize = this._renderer.getDrawingBufferSize(
      new Vector2(),
    );
    this._pickHelper?.setSize(drawingBufferSize.x, drawingBufferSize.y);

    this._core?.resize(w, h, pixelRatio ?? 1);
    this._scheduleFixedGpuBytesReport();

    this.emit("resize", w, h);
  };

  /**
   * Walks the fixed render-target stack and pushes the estimate into the
   * memory ledger; the WASM call is skipped while the value is unchanged.
   */
  private _reportFixedGpuBytes(): void {
    if (this._disposed || !this._core) return;
    const bytes = this.renderPassOrchestrator.estimateFixedGpuBytes();
    this.framesSinceFixedGpuBytesReport = 0;
    if (bytes === this.lastReportedFixedGpuBytes) return;
    this.lastReportedFixedGpuBytes = bytes;
    this._core.setFixedGpuBytes(bytes);
  }

  /**
   * Re-reports the fixed GPU footprint for event-triggered changes (init,
   * resize, pass add/remove). Scheduled as a microtask so bursts — e.g.
   * effect setup during init — coalesce into a single walk, and marks a
   * one-shot post-render resync because these events run before the GPU has
   * lazily allocated the affected targets.
   */
  private _scheduleFixedGpuBytesReport(): void {
    this.fixedGpuBytesResyncPending = true;
    if (this.fixedGpuBytesReportScheduled) return;
    this.fixedGpuBytesReportScheduled = true;
    queueMicrotask(() => {
      this.fixedGpuBytesReportScheduled = false;
      this._reportFixedGpuBytes();
    });
  }

  private _updateUniforms() {
    const viewport = this._getCanvasSize();
    const pixelRatio = this._renderer.getPixelRatio();

    // Ref: https://github.com/CesiumGS/cesium/blob/2cf09cb06e4f7ea767da39befabcfc3444b02c49/packages/engine/Source/Core/PerspectiveFrustum.js#L208-L218
    // raw.fov mirrors the engine's vertical fov (degrees) via the frustum
    // event pump. Plain arithmetic: this must not depend on the WASM-backed
    // degreeToRadian helper.
    const fovY = (this._camera.raw.fov * Math.PI) / 180;
    const top = this._camera.raw.near * Math.tan(0.5 * fovY);
    const bottom = -top;
    const right = this._camera.raw.aspect * top;
    const left = -right;

    this._uniforms.viewportAndPixelRatio.value = [
      viewport?.width ?? 0,
      viewport?.height ?? 0,
      pixelRatio,
    ];
    this._uniforms.frustumNearFar.value = [
      this._camera.raw.near,
      this._camera.raw.far,
    ];
    this._uniforms.frustumRatio.value = [top, bottom, right, left];
    this._uniforms.tGlobeDepth.value =
      this.renderPass.globeDepthCopyPass.texture;
    this._uniforms.tGlobeNormal.value =
      this.renderPass.globeNormalCopyPass.texture;
    this._uniforms.tSkyEnvMap.value =
      this.skyEnvMap.ref.raw?.getEnvMapTexture() ?? null;
    this._uniforms.inverseProjectionMatrix.value =
      this._camera.raw.projectionMatrixInverse;

    // Vertical fov in radians (raw.fov is kept in sync with the engine).
    this._uniforms.fov.value = fovY;
    this._uniforms.screenHeightPx.value = viewport?.height ?? 0;
  }

  /** Returns true if the scene was updated and needs to be rendered. */
  private _update(updatedAt: number): boolean {
    this.emit("preUpdate", updatedAt);

    this._core?.update(updatedAt);

    const events = this._core?.readEvents();
    if ((!events && !this._eventManager.needsUpdate()) || !this._core) {
      return false;
    }

    this.eventContext.updatedAt = updatedAt;

    processEvent(this.eventContext, events);

    events?.free();

    // Evict JS-side `InMemoryBufferStore` entries whose WASM `External` handles
    // Rust freed this frame (tile destroy, DataRequester removal, ...), keeping
    // the two stores in step.
    this._buf.drainRemovedExternalHandles();

    this._camera.raw.updateMatrixWorld();

    this._updateUniforms();

    this.emit("postUpdate", updatedAt);

    return true;
  }

  /**
   * Process feature updates for all descriptors
   * This is called after the main update loop to batch feature updates
   */
  private _forceFeatureUpdates(updatedAt: number) {
    // Process updates for each layer
    for (const layer of this.layersManager.getResourceLayers()) {
      if (layer._processFeatureUpdates(updatedAt)) {
        this._renderFlag.forceUpdate = true;
      }
    }
  }

  /**
   * Ask for a future frame on behalf of the declutter pass. Runs through a
   * timer because the main loop clears `forceUpdate` right after `_render` —
   * a flag set synchronously here would be wiped before the next tick reads
   * it. A pending longer timer is preempted when a shorter delay is needed
   * (a fade must not wait out a throttle window).
   */
  private _scheduleDeclutterFrame(delayMs: number) {
    if (this._declutterRetry !== undefined) {
      if (delayMs >= this._declutterRetryDelay) return;
      clearTimeout(this._declutterRetry);
    }
    this._declutterRetryDelay = delayMs;
    this._declutterRetry = setTimeout(() => {
      this._declutterRetry = undefined;
      this._renderFlag.forceUpdate = true;
    }, delayMs);
  }

  private _render(updatedAt: number) {
    // Read the vector/raster resolution revisions once per frame so each terrain
    // tile's `onBeforeRender` can gate its slot re-fetch against them without its
    // own FFI calls.
    this._vectorRevision = this._core?.vectorRevision() ?? this._vectorRevision;
    this._rasterRevision = this._core?.rasterRevision() ?? this._rasterRevision;

    this._uniforms.time.value = updatedAt;

    this._atmosphere._update();

    // Screen-space label decluttering runs before the render passes so
    // placement changes land in this frame. Throttled passes and active
    // fades both need future frames, requested via _scheduleDeclutterFrame.
    {
      const size = this._renderer.getDrawingBufferSize(this._declutterSize);
      const pixelRatio = this._renderer.getPixelRatio();
      const result = this._declutter.update(
        this._camera.raw,
        size.x / pixelRatio,
        size.y / pixelRatio,
        updatedAt,
      );
      if (result === "throttled") {
        this._scheduleDeclutterFrame(
          this._declutter.remainingThrottleMs(updatedAt),
        );
      } else if (result === "animating") {
        // Keep frames coming at fade cadence until every label reaches its
        // placement target.
        this._scheduleDeclutterFrame(16);
      }
    }

    this.emit("preRender", updatedAt);

    this.renderPassOrchestrator.render();
    this._pickHelper?.renderDebugCanvas();

    this.shadowMapViewers.render(this._renderer);

    this.emit("postRender", updatedAt);

    // Render targets are GL-allocated lazily during rendering (and freed on
    // resize), so a footprint taken at init/resize/pass-change time goes
    // stale: re-estimate once on the first frame after such an event, and
    // otherwise at a low cadence. The report skips the WASM call when the
    // value is unchanged.
    if (this.fixedGpuBytesResyncPending) {
      this.fixedGpuBytesResyncPending = false;
      this._reportFixedGpuBytes();
    } else if (++this.framesSinceFixedGpuBytesReport >= 120) {
      this.framesSinceFixedGpuBytesReport = 0;
      this._reportFixedGpuBytes();
    }
  }

  /**
   * Since passing Color class to WASM is tricky, converts Navara Color
   * objects to numbers in layer descriptions.
   * Handles the two-level structure: layer -> material -> color fields.
   */
  private _convertColorsToNumbers(obj: unknown): unknown {
    if (obj === null || obj === undefined || typeof obj !== "object") {
      return obj;
    }

    // Process the object's properties (shallow copy)
    const result: Record<string, unknown> = { ...obj };

    for (const [key, value] of Object.entries(result)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        // Nested object (e.g., point, billboard, text, model, etc.)
        const nestedResult: Record<string, unknown> = { ...value };
        for (const [nestedKey, nestedValue] of Object.entries(nestedResult)) {
          if (nestedValue instanceof Color) {
            nestedResult[nestedKey] = nestedValue.toHex();
          }
        }
        result[key] = nestedResult;
      }
    }

    return result;
  }

  /**
   * Adds a new resource layer (GIS data layer) to the scene.
   * For meshes, lights, and effects, use `addMesh()`, `addLight()`, and `addEffect()` instead.
   * @param l - Resource layer configuration object specifying type and options
   * @returns A Layer for controlling the added layer
   */
  addLayer(l: LayerDescription): Layer {
    // Normalize a Source handle reference to its id before passing to Rust.
    const normalized =
      "source" in l && l.source instanceof Source
        ? { ...l, source: l.source.id }
        : l;

    // Convert all Color objects to numbers before passing to Rust
    const processedLayer = this._convertColorsToNumbers(
      normalized,
    ) as LayerDescription;

    // Existing resource layer process
    const layerId = this._core?.addLayer(processedLayer);
    invariant(layerId);
    invariant(this._core);

    const layer = new Layer(
      layerId,
      this._core,
      this._convertColorsToNumbers.bind(this),
    );
    this.layersManager.add(layer);

    return layer;
  }

  /**
   * Registers a data source (GeoJSON, vector tile, raster tile, raster DEM,
   * quantized mesh, 3D Tiles) and returns a {@link Source} handle.
   * Reference the returned source from layers via `addLayer({ source })`.
   * @param s - Source configuration object specifying type and options
   * @returns A Source handle for referencing, updating, and deleting the source
   */
  addSource(s: SourceDescription): Source {
    invariant(this._core);
    invariant(s.type);
    const sourceId = this._core.addSource(s);

    return new Source(sourceId, s.type, this._core);
  }

  /**
   * Tracks a possibly-async `onCreate()` (see `BaseDesc.onCreate`): the
   * `add*` methods still return their handle synchronously, the descriptor's
   * instance appears when the promise settles, and a rejection is logged and
   * reported through the descriptor's `error` event (when it declares one).
   *
   * `wire` binds the descriptor's lifecycle hooks (per-frame `update`,
   * `onResize`, `needsUpdate`). It runs immediately for a synchronous
   * creation, and only after the promise resolves for an async one — the
   * hooks must not fire while the descriptor has no instance yet.
   */
  private _trackAsyncCreate(
    kind: "mesh" | "light" | "effect",
    desc: { emit: (event: never, ...args: never[]) => void },
    result: void | Promise<void>,
    wire: () => void,
  ): void {
    if (!(result instanceof Promise)) {
      wire();
      return;
    }
    result.then(wire, (error: unknown) => {
      console.error(`Failed to create ${kind} descriptor:`, error);
      (desc.emit as (event: string, payload: unknown) => void)("error", error);
    });
  }

  /**
   * Adds a 3D mesh to the scene.
   * The mesh kind is determined by the nested key (e.g., `{ box: { width: 200 } }`).
   * @param desc - Mesh configuration object
   * @returns A MeshHandle for controlling the added mesh
   */
  addMesh<L extends AnyMeshDesc = AnyMeshDesc>(
    config: OmitType<MeshConfig | NonNullable<D["mesh"]>>,
  ): MeshHandle<L> {
    // Find which mesh type from config
    const meshType = this.registries.mesh.findMeshType(config);
    if (!meshType) {
      throw new UnknownTypeError("mesh", config);
    }

    // Create mesh descriptor instance
    const meshDesc = this.registries.mesh.create(meshType, config);

    // Initialize the mesh; hooks are wired once the instance exists.
    this._trackAsyncCreate("mesh", meshDesc, meshDesc.onCreate(), () => {
      // If deleted while an async creation was loading, nothing to wire.
      if (meshDesc.destroyed) return;

      // Set up update listener
      if (meshDesc.update) {
        this.on("preRender", meshDesc.update.bind(meshDesc));
      }

      if (meshDesc.onResize) {
        this.on("resize", meshDesc.onResize.bind(meshDesc));

        const canvasSize = this._getCanvasSize();
        if (canvasSize) {
          meshDesc.onResize(canvasSize.width, canvasSize.height);
        }
      }

      // Trigger re-render
      meshDesc.on("needsUpdate", this.forceUpdate);

      this.forceUpdate();
    });

    const l = new MeshHandle(meshDesc);

    l.on("deleted", this.forceUpdate);

    // Store the mesh descriptor
    this.layersManager.add(l);

    // Return handle for imperative access
    return l as MeshHandle<L>;
  }

  /**
   * Adds a light to the scene.
   * The light kind is determined by the nested key (e.g., `{ ambient: { intensity: 0.5 } }`).
   * @param desc - Light configuration object
   * @returns A LightHandle for controlling the added light
   */
  addLight<L extends LightDesc = LightDesc>(
    config: OmitType<LightConfig | NonNullable<D["light"]>>,
  ): LightHandle<L> {
    // Find which light type from config
    const lightType = this.registries.light.findLightType(config);
    if (!lightType) {
      throw new UnknownTypeError("light", config);
    }

    // Create light descriptor instance
    const lightDesc = this.registries.light.create(lightType, config);

    // Initialize the light; hooks are wired once the instance exists.
    this._trackAsyncCreate("light", lightDesc, lightDesc.onCreate(), () => {
      // Deleted while an async creation was loading — nothing to wire.
      if (lightDesc.destroyed) return;

      // Set up update listener if the descriptor has an update method
      if (lightDesc.update) {
        this.on("preRender", lightDesc.update.bind(lightDesc));
      }

      // Trigger re-render
      lightDesc.on("needsUpdate", this.forceUpdate);

      this.forceUpdate();
    });

    const l = new LightHandle(lightDesc);

    l.on("deleted", this.forceUpdate);

    // Store the light descriptor
    this.layersManager.add(l);

    // Return handle for imperative access
    return l as LightHandle<L>;
  }

  /**
   * Adds a post-processing effect to the scene.
   * The effect kind is determined by the nested key (e.g., `{ bloom: { strength: 1.0 } }`).
   * @param desc - Effect configuration object
   * @returns An EffectHandle for controlling the added effect
   */
  addEffect<L extends EffectDesc = EffectDesc>(
    config: OmitType<
      BuiltInEffectDescription | EffectConfig | NonNullable<D["effect"]>
    >,
  ): EffectHandle<L> {
    // Find which effect type from config
    const effectType = this.registries.effect.findEffectType(config);
    if (!effectType) {
      throw new UnknownTypeError("effect", config);
    }

    // Reject the effect while nothing is created yet if its required
    // G-buffers would exceed the device's MRT attachment limit
    // (gl.MAX_DRAW_BUFFERS – spec minimum 4, nearly all devices expose 8).
    this._assertGBufferCapacity(effectType);

    // Create effect descriptor instance
    const effectDesc = this.registries.effect.create(effectType, config);

    const l = new EffectHandle(effectDesc);

    // Store the effect descriptor
    this.layersManager.add(l);

    // Allocate before `onCreate()`: `createPass()` reads the buffers this
    // effect declared, so they have to exist by then. Reallocates attachments
    // and recompiles shaders when the derived configuration actually changes,
    // so tune effects via `update()` rather than re-adding them.
    this._syncGBuffers();
    l.on("deleted", () => {
      this._syncGBuffers();
      this.forceUpdate();
    });

    // Initialize the effect; hooks are wired once the instance exists.
    this._trackAsyncCreate("effect", effectDesc, effectDesc.onCreate(), () => {
      // Deleted while an async creation was loading — nothing to wire.
      if (effectDesc.destroyed) return;

      // Set up update listener if the descriptor has an update method
      if (effectDesc.update) {
        this.on("preRender", effectDesc.update.bind(effectDesc));
      }

      // Trigger re-render
      effectDesc.on("needsUpdate", this.forceUpdate);

      this.forceUpdate();
    });

    // Return handle for imperative access
    return l as EffectHandle<L>;
  }

  /**
   * Re-derives the G-buffer configuration from the union of the active
   * effects' `requiredBuffers` and applies it to the MRT pass when changed.
   */
  private _syncGBuffers = (): void => {
    const requirements: (readonly GBufferName[])[] = [];
    for (const handle of this.layersManager.getEffectDescs()) {
      const EffectClass = handle.ref.constructor as {
        requiredBuffers?: readonly GBufferName[];
      };
      if (EffectClass.requiredBuffers) {
        requirements.push(EffectClass.requiredBuffers);
      }
    }
    // Draped meshes are not effects, so they cannot declare this themselves:
    // they read the terrain normal through the globe-normal copy.
    if (this._scenes.draped.children.length > 0) {
      requirements.push(["globeNormal"]);
    }
    this._buffers = unionGBufferRequirements(requirements);
    this.viewContext._setGBufferOptions(this._buffers);
  };

  /**
   * Throws when enabling `effectType`'s required G-buffers would push the
   * attachment count (color + normal + optional buffers) past the device's
   * `MAX_DRAW_BUFFERS` limit.
   */
  private _assertGBufferCapacity(effectType: string): void {
    const required = this.registries.effect.getRequiredBuffers(effectType);
    if (required.length === 0) return;
    const prospective = unionGBufferRequirements([
      (Object.keys(this._buffers) as GBufferName[]).filter(
        (name) => this._buffers[name],
      ),
      required,
    ]);
    const attachmentCount =
      2 + GBUFFER_ATTACHMENT_NAMES.filter((name) => prospective[name]).length;
    // Navara requires WebGL2 (MRT), so the context is always WebGL2.
    const gl = this.viewContext
      .getRenderer()
      .getContext() as WebGL2RenderingContext;
    const maxDrawBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS) as number;
    if (attachmentCount > maxDrawBuffers) {
      throw new Error(
        `The "${effectType}" effect requires G-buffers [${required.join(", ")}], ` +
          `but the resulting ${attachmentCount} MRT attachments exceed this ` +
          `device's MAX_DRAW_BUFFERS (${maxDrawBuffers}).`,
      );
    }
  }

  /**
   * Finds a resource layer by its ID.
   * Only returns resource layers added via `addLayer()` (not mesh, light, or
   * effect descriptors).
   * @param id - The unique identifier of the layer to find
   * @returns The matching {@link Layer}, or `undefined` if none exists
   */
  findLayerById(id: string): Layer | undefined {
    const target = this.layersManager.get(id);
    return target instanceof Layer ? target : undefined;
  }

  /**
   * Updates an existing resource layer's configuration by its ID.
   * Only works for resource layers added via `addLayer()`.
   * @param id - The unique identifier of the layer to update
   * @param l - New layer configuration
   */
  updateLayerById(id: string, l: LayerDescription) {
    invariant(this._core);
    const target = this.layersManager.get(id);
    if (!target || !(target instanceof Layer)) return;
    target.update(l);
  }

  /**
   * Updates an existing mesh descriptor's configuration by its ID.
   * @param id - The unique identifier of the mesh to update
   * @param updates - Partial configuration object with properties to update
   */
  updateMeshById(
    id: string,
    updates: OmitType<MeshConfig | NonNullable<D["mesh"]>>,
  ) {
    const target = this.layersManager.get(id);
    if (!target || !(target instanceof MeshHandle)) return;
    target.update(updates);
  }

  /**
   * Updates an existing light descriptor's configuration by its ID.
   * @param id - The unique identifier of the light to update
   * @param updates - Partial configuration object with properties to update
   */
  updateLightById(
    id: string,
    updates: OmitType<LightConfig | NonNullable<D["light"]>>,
  ) {
    const target = this.layersManager.get(id);
    if (!target || !(target instanceof LightHandle)) return;
    target.update(updates);
  }

  /**
   * Updates an existing effect descriptor's configuration by its ID.
   * @param id - The unique identifier of the effect to update
   * @param updates - Partial configuration object with properties to update
   */
  updateEffectById(
    id: string,
    updates: OmitType<
      BuiltInEffectDescription | EffectConfig | NonNullable<D["effect"]>
    >,
  ) {
    const target = this.layersManager.get(id);
    if (!target || !(target instanceof EffectHandle)) return;
    target.update(updates);
  }

  /**
   * Deletes a resource layer from the scene by its ID.
   * @param id - The unique identifier of the layer to delete
   * @returns `true` if the layer was found and deleted, `false` otherwise
   */
  deleteLayerById(id: string): boolean {
    invariant(this._core);
    const target = this.layersManager.get(id);
    if (!target || !(target instanceof Layer)) return false;
    target.delete();
    return true;
  }

  /**
   * Deletes a mesh descriptor from the scene by its ID.
   * @param id - The unique identifier of the mesh to delete
   * @returns `true` if the mesh was found and deleted, `false` otherwise
   */
  deleteMeshById(id: string): boolean {
    const target = this.layersManager.get(id);
    if (!target || !(target instanceof MeshHandle)) return false;
    target.delete();
    return true;
  }

  /**
   * Deletes a light descriptor from the scene by its ID.
   * @param id - The unique identifier of the light to delete
   * @returns `true` if the light was found and deleted, `false` otherwise
   */
  deleteLightById(id: string): boolean {
    const target = this.layersManager.get(id);
    if (!target || !(target instanceof LightHandle)) return false;
    target.delete();
    return true;
  }

  /**
   * Deletes an effect descriptor from the scene by its ID.
   * @param id - The unique identifier of the effect to delete
   * @returns `true` if the effect was found and deleted, `false` otherwise
   */
  deleteEffectById(id: string): boolean {
    const target = this.layersManager.get(id);
    if (!target || !(target instanceof EffectHandle)) return false;
    target.delete();
    return true;
  }

  private registerBuiltIns(): void {
    this.registerBuiltInEffects();
  }

  private registerBuiltInEffects(): void {
    this.registerEffect("skyEnvMap", SkyEnvMapEffectDesc);
    this.registerEffect("mrt", MRTPassEffectDesc);
    this.registerEffect("transparent", TransparentPassEffectDesc);

    this.registerEffect("final", FinalCopyEffectDesc);
  }

  /**
   * Registers a custom mesh descriptor type for use with addMesh().
   * @param name - Unique name to identify this mesh type in descriptor configurations
   * @param meshClass - The mesh descriptor class constructor
   */
  registerMesh(name: string, meshClass: MeshDescConstructor): void {
    this.registries.mesh.register(name, meshClass);
  }

  /**
   * Registers a custom light descriptor type for use with addLight().
   * @param name - Unique name to identify this light type in descriptor configurations
   * @param lightClass - The light descriptor class constructor
   */
  registerLight(name: string, lightClass: LightDescConstructor): void {
    this.registries.light.register(name, lightClass);
  }

  /**
   * Registers a custom post-processing effect descriptor type for use with addEffect().
   * @param name - Unique name to identify this effect type in descriptor configurations
   * @param effectClass - The effect descriptor class constructor
   */
  registerEffect(name: string, effectClass: EffectDescConstructor): void {
    this.registries.effect.register(name, effectClass);
  }

  /**
   * Adds a plugin to the view. Plugins are initialized during `init()`.
   * Must be called before `init()`.
   * @param plugin - The plugin instance to add
   * @returns This view instance for chaining
   */
  addPlugin(plugin: Plugin): this {
    if (this._initialized)
      throw new Error("Plugin must be added before `view.init()`.");
    this.plugins.push(plugin);
    return this;
  }

  /**
   * Register a font family with multiple faces.
   * Each face covers a set of unicode ranges and points to a separate font file URL.
   * When a text label uses this family name as its font, only the face files
   * whose unicode ranges cover the label's characters are loaded.
   *
   * Face priority and fallback:
   * - Faces are evaluated in the order given in `faces`. For each codepoint,
   *   the first face whose `unicodeRanges` includes that codepoint is used,
   *   so earlier entries win when ranges overlap.
   * - Codepoints not covered by any face fall back to the first face
   *   (`faces[0]`), which may therefore be downloaded for uncovered characters
   *   even if its declared `unicodeRanges` do not include them.
   *
   * Put the intended fallback face at index `0`: it is both the fallback for
   * uncovered codepoints and the highest-priority face when ranges overlap.
   * Order the remaining faces after it by priority, and avoid overlapping
   * ranges unless that precedence is intentional.
   *
   * @example
   * ```ts
   * view.addFontFamily({
   *   family: "MapFont",
   *   faces: [
   *     {
   *       url: "/fonts/latin.woff2",
   *       unicodeRanges: [{ from: 0x0000, to: 0x024f }],
   *     },
   *     {
   *       url: "/fonts/cjk.woff2",
   *       unicodeRanges: [{ from: 0x4e00, to: 0x9fff }],
   *     },
   *   ],
   * });
   * ```
   *
   * Instead of writing faces and ranges by hand, they can be derived from a
   * stylesheet's `@font-face` rules (e.g. the Google Fonts CSS API) with
   * {@link fetchFontFamilyFromCss} / {@link parseFontFamilyFromCss}:
   *
   * @example
   * ```ts
   * view.addFontFamily(
   *   await fetchFontFamilyFromCss(
   *     "MapFont",
   *     "https://fonts.googleapis.com/css2?family=Noto+Sans&family=Noto+Sans+JP",
   *   ),
   * );
   * ```
   */
  addFontFamily(family: FontFamily): this {
    this._fontManager.registerFontFamily(family);
    return this;
  }

  /** Remove a previously registered font family by name. */
  removeFontFamily(family: string): this {
    this._fontManager.unregisterFontFamily(family);
    return this;
  }

  /**
   * Sets the camera position and orientation instantly.
   * @param camPos - Camera position with lng (degrees), lat (degrees), height (meters), and optional pitch, heading, roll (degrees)
   */
  setCamera(camPos: CameraPosition) {
    function checkFinite(value: number | undefined): value is number {
      return Number.isFinite(value) && value != null;
    }

    const lng = camPos.lng;
    const lat = camPos.lat;
    const position =
      checkFinite(lng) && checkFinite(lat)
        ? new Float64Array([lng, lat, camPos.height ?? 0])
        : null;

    this._core?.changeCamera(
      position,
      camPos.pitch,
      camPos.heading,
      camPos.roll,
      camPos.distance,
    );
  }

  /**
   * Moves the camera in a specified direction.
   * @param move - Direction: `CameraDirection`
   * @param amount - Distance to move in meters
   */
  moveCamera(move: CameraDirection, amount: number) {
    switch (move) {
      case CameraDirection.Forward:
        this._core?.moveCamera(CameraDirection.Forward, amount);
        break;
      case CameraDirection.Backward:
        this._core?.moveCamera(CameraDirection.Backward, amount);
        break;
      case CameraDirection.Up:
        this._core?.moveCamera(CameraDirection.Up, amount);
        break;
      case CameraDirection.Down:
        this._core?.moveCamera(CameraDirection.Down, amount);
        break;
      case CameraDirection.Left:
        this._core?.moveCamera(CameraDirection.Left, amount);
        break;
      case CameraDirection.Right:
        this._core?.moveCamera(CameraDirection.Right, amount);
        break;
      default:
        break;
    }
  }

  /**
   * Moves the camera along a custom direction vector.
   * @param dir - Direction vector as [x, y, z] array
   * @param amount - Distance to move in meters
   */
  moveCameraWithDirection(dir: number[], amount: number) {
    if (dir.length !== 3) {
      return;
    }

    this._core?.moveCameraWithDirection(new Float64Array(dir), amount);
  }

  /**
   * Animates the camera to fly to a target position.
   *
   * The flight follows an arced path: the default duration is derived from
   * the flight distance (2–3 s), the default easing is `quinticInOut`
   * (`cubicOut` when descending from high altitude), and longitudes take the
   * short way across the antimeridian.
   *
   * @param camPos - Target position with required lng/lat (degrees). Provide either `height` (meters above the ellipsoid)
   *   or `distance` (meters from the target point along the camera forward direction). Optional pitch, heading, roll (degrees).
   * @param options - Flight options (`duration`, `maxHeight`, `easing`)
   * @returns A promise resolving to `true` when the flight completes, or
   *   `false` when it is interrupted by another camera operation, such as a
   *   newer `flyTo` or a `setCamera` call.
   */
  flyTo(
    camPos: CameraPosition &
      Required<Pick<CameraPosition, "lng" | "lat">> &
      ({ height: number } | { distance: number }),
    options: FlyToOptions = {},
  ): Promise<boolean> {
    const pos = camPos as CameraPosition & { lng: number; lat: number };
    const position = new Float64Array([pos.lng, pos.lat, pos.height ?? 0]);

    const id = this._core?.flyTo(
      position,
      pos.pitch,
      pos.heading,
      pos.roll,
      options.duration,
      options.maxHeight,
      pos.distance,
      options.easing === undefined
        ? undefined
        : FLY_TO_EASING_CODE[options.easing],
    );

    if (id === undefined) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      this._pendingFlights.set(id, resolve);
    });
  }

  /**
   * Makes the camera look at a target position with an offset.
   * @param target - Target geodetic position (lng in degrees, lat in degrees, height in meters)
   * @param offset - Offset from the target in East-North-Up (ENU) coordinates (meters)
   */
  lookAt(target: LatLngHeight, offset: Vector3) {
    this._core?.lookAt(
      new Float64Array([target.lng, target.lat, target.height]),
      new Float64Array([offset.x, offset.y, offset.z]),
    );
  }

  /**
   * Enables or disables camera following mode.
   * @param enabled - Whether to enable camera following
   * @param target - Target geodetic position to follow (lng in degrees, lat in degrees, height in meters)
   * @param offset - Offset from the target in East-North-Up (ENU) coordinates (meters)
   */
  cameraFollow(enabled: boolean, target?: LatLngHeight, offset?: Vector3) {
    const targetArray = target
      ? new Float64Array([target.lng, target.lat, target.height])
      : undefined;
    const offsetArray = offset
      ? new Float64Array([offset.x, offset.y, offset.z])
      : undefined;

    this._core?.cameraFollow(enabled, targetArray, offsetArray);
  }

  /**
   * Enables position-locked free-look. The camera stays at the target
   * position while mouse drag rotates orientation in place. Use for
   * first-person-view "look around" controls.
   * @param enabled - Whether to enable free-look mode
   * @param target - Target geodetic position the camera is locked to (lng/lat degrees, height meters)
   */
  cameraFreeLook(enabled: boolean, target?: LatLngHeight) {
    const targetArray = target
      ? new Float64Array([target.lng, target.lat, target.height])
      : undefined;

    this._core?.cameraFreeLook(enabled, targetArray);
  }

  /**
   * Samples the terrain height at a given geodetic position synchronously.
   * @param pos - Geodetic position (lat in degrees, lng in degrees)
   * @returns Terrain height in meters, or undefined if terrain data not loaded
   */
  sampleTerrainHeight(pos: LatLng): number | undefined {
    const lle = new LLE(degreeToRadian(pos.lat), degreeToRadian(pos.lng), 0);
    return this._core?.sampleTerrainHeight(lle);
  }

  /**
   * Samples terrain heights at the most detailed zoom level the terrain
   * source provides, fetching the needed tiles over the network — unlike
   * {@link sampleTerrainHeight}, which reads only tiles already resident for
   * rendering and returns coarse-LOD heights (or nothing) when the camera is
   * far away. Use this to place objects on the ground before the camera has
   * streamed the area in.
   *
   * `source` is a registered `quantized-mesh` / `raster-dem` source: the
   * {@link Source} handle returned by `addSource`, or its id. The stored
   * config (including engine defaults and partial-update merges) is what gets
   * sampled.
   *
   * @param source - A registered terrain source (handle or id)
   * @param positions - Geodetic positions (lat/lng in degrees)
   * @param options - Optional abort signal and fixed-level sampling
   * @returns One result per input position, in the same order
   */
  async sampleTerrainMostDetailed(
    source: SourceRef,
    positions: LatLng[],
    options?: SampleTerrainOptions,
  ): Promise<SampledTerrainPosition[]> {
    invariant(this._core);
    const sourceId = source instanceof Source ? source.id : source;
    const description = this._core.getSourceDescription(sourceId) as
      TerrainSampleSource | undefined;
    if (
      description?.type !== "quantized-mesh" &&
      description?.type !== "raster-dem"
    ) {
      throw new Error(
        `sampleTerrainMostDetailed: source "${sourceId}" is not a registered quantized-mesh or raster-dem source`,
      );
    }
    return sampleTerrainMostDetailed(description, positions, options);
  }

  /**
   * Observes terrain height changes at a position. Callback is invoked each time terrain data updates.
   * @param pos - Geodetic position to observe (lat in degrees, lng in degrees)
   * @param cb - Callback function receiving the terrain height in meters
   * @returns Cleanup function to stop observing
   */
  observeTerrainHeightAt(
    pos: LatLng,
    cb: (height: number) => void,
  ): () => void {
    if (!this._core) {
      return () => {};
    }

    const lle = new LLE(degreeToRadian(pos.lat), degreeToRadian(pos.lng), 0);
    const entityBits = this._core.registerSampleTerrainHeightEvent(lle);

    const callFunc = (ev: TerrainHeightUpdatedEvent) => {
      if (hasObservedTerrainHeight(ev, entityBits)) {
        cb(ev.height);
      }
    };

    this.on("_sample_terrain_height_received", callFunc);

    return () => {
      this._core?.unregisterSampleTerrainHeightEvent(entityBits);
      this.off("_sample_terrain_height_received", callFunc);
    };
  }

  /**
   * Rotates the camera around an axis.
   * @param axis - Axis to rotate around (zero vector uses default)
   * @param angle - Rotation angle in radians
   */
  rotateAroundAxis(axis: Vector3, angle: number) {
    this._core?.rotateAroundAxis(
      new Float64Array([axis.x, axis.y, axis.z]),
      angle,
    );
  }

  /**
   * Rotates the camera around the current look-at point or center of view.
   * @param angle - Rotation angle in radians
   */
  rotateAround(angle: number) {
    this._core?.rotateAroundAxis(null, angle);
  }

  private _startMainLoop() {
    const idleThreshold = this._options.idleThreshold ?? 100;
    const loop: XRFrameRequestCallback = (time) => {
      if (this._disposed) return;
      this._stats?.begin();

      this._forceFeatureUpdates(time);

      const updated = this._update(time);
      if (updated || this._renderFlag.forceUpdate || this._renderFlag.animation)
        this._render(time);
      this._renderFlag.forceUpdate = false;

      if (updated) {
        this._isIdle = false;
      } else if (
        !this._isIdle &&
        this.eventContext.updatedAt > 0 &&
        time - this.eventContext.updatedAt >= idleThreshold
      ) {
        this._isIdle = true;
        this.emit("idle");
      }

      this._stats?.end();
    };
    this._renderer.setAnimationLoop(loop);
  }

  private _getCanvasSize(): { width: number; height: number } | undefined {
    const element =
      this._options.container ??
      this._renderer.domElement?.parentElement ??
      this._renderer.domElement;
    if (!element) return;

    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (typeof width !== "number" && typeof height !== "number") {
      return;
    }

    return { width, height };
  }

  private _handleResize = () => {
    const { width, height } = this._getCanvasSize() ?? {};
    if (!width || !height) return;

    // Route through getDevicePixelRatio so a devicePixelRatio change (zoom,
    // monitor move) cannot bypass the mobile caps applied at init.
    const pixelRatio = isWorker()
      ? (this._options.pixelRatio ?? 1)
      : getDevicePixelRatio({
          override: this._options.pixelRatio,
          mobileOptimization: this._options.mobileOptimization,
        });
    this.resize(width, height, pixelRatio);
  };

  /**
   * Resolves a picked batch ID into feature information via the engine's
   * property store.
   */
  private resolvePickedFeature(batchId: number): PickedFeature {
    const prop = this._core?.readPropertyByGlobalBatchId(batchId);
    if (prop) {
      return {
        properties: prop.properties,
        // The GPU pick returns the clicked instance's id; report the
        // feature's canonical batch id instead so it matches the id the
        // evaluator exposes (a MultiPoint feature spans many instances).
        batchId: prop.batchId ?? batchId,
        layerId: prop.layerId,
      };
    }
    return {
      properties: {},
      batchId,
      layerId: undefined,
    };
  }

  /**
   * Handles pick events and emits the picked feature information.
   * @param pickArr - Array of picked batch IDs
   */
  private onPick(pickArr: number[]) {
    this._renderFlag.forceUpdate = true;

    if (pickArr.length > 0) {
      this.emit("featureClick", this.resolvePickedFeature(pickArr[0]));
    } else {
      this.emit("featureClick", null);
    }
  }

  /**
   * Handles hover pick results and synthesizes `featureHover` / `featureEnter` /
   * `featureLeave` events by diffing against the previously hovered feature.
   * @param pickArr - Array of picked batch IDs
   */
  private onHoverPick(pickArr: number[]) {
    // The pick render re-bakes draped vector atlases in pick mode; a main
    // render is needed to restore their normal colors.
    this._renderFlag.forceUpdate = true;

    const batchId = pickArr.length > 0 ? pickArr[0] : 0;
    const prev = this._hoveredFeature;
    if ((prev?.batchId ?? 0) === batchId) return;

    const feature = batchId > 0 ? this.resolvePickedFeature(batchId) : null;
    this._hoveredFeature = feature;

    if (prev) this.emit("featureLeave", prev);
    if (feature) this.emit("featureEnter", feature);
    this.emit("featureHover", feature);
  }

  /**
   * Gets whether continuous animation mode is enabled.
   */
  get animation() {
    return this._renderFlag.animation;
  }
  /**
   * Sets whether to render every frame continuously (true) or only on changes (false).
   */
  set animation(v: boolean) {
    this._renderFlag.animation = v;
  }

  /**
   * Gets the canvas element the view renders into. Useful for styling,
   * e.g. switching the cursor from a `featureHover` event listener.
   */
  get canvas(): HTMLCanvasElement {
    return this._renderer.domElement;
  }

  /**
   * Gets the current screen size in pixels.
   */
  get screenSize() {
    const size = new Vector2();
    this._renderer.getSize(size);
    return size;
  }

  /**
   * Gets the current device pixel ratio.
   */
  get pixelRatio() {
    return this._renderer.getPixelRatio();
  }

  /**
   * Gets whether shadow map debug viewers are displayed.
   */
  get shadowMapViewersEnabled() {
    return this.shadowMapViewers.enabled;
  }
  /**
   * Enables or disables shadow map debug viewers on screen.
   */
  set shadowMapViewersEnabled(v: boolean) {
    this.shadowMapViewers.enabled = v;
  }

  /**
   * Picks the terrain position at screen coordinates.
   * @param x - Screen X coordinate in CSS pixels (same as MouseEvent.clientX)
   * @param y - Screen Y coordinate in CSS pixels (same as MouseEvent.clientY)
   * @returns World position Vector3 in ECEF coordinates, or null if no terrain is hit
   */
  pickTerrainPosition(x: number, y: number): Nullable<Vector3> {
    return this._terrainPicker.pick(
      x,
      y,
      this._renderer,
      this.globeDepthTexture,
      this._camera.raw,
    );
  }

  /**
   * Picks the position at screen coordinates from the depth.
   * @param x - Screen X coordinate in CSS pixels (same as MouseEvent.clientX)
   * @param y - Screen Y coordinate in CSS pixels (same as MouseEvent.clientY)
   * @returns World position Vector3 in ECEF coordinates, or null if nothing is hit
   */
  pickDepthPosition(x: number, y: number): Nullable<Vector3> {
    return this._terrainPicker.pick(
      x,
      y,
      this._renderer,
      this.depthTexture,
      this._camera.raw,
    );
  }
}

function newId() {
  return Math.random().toString(36).slice(2);
}
