import type {
  Color as CoreColor,
  ColorMap,
  EventHandler,
  EventManager,
} from "@navaramap/core";
import type {
  DelegatedWorkerTasksResult,
  ElevationDecoder,
  RasterTileState,
  ReconstructableEntity,
  ReturnedTransferablePolygonBatchedFeature,
  ReturnedTransferablePolylineBatchedFeature,
  TextureFragmentStatus,
  TransferableMartini,
  TransferableTile,
  VectorTileState,
} from "@navaramap/engine";
import type { FontManager } from "@navaramap/font";
import type { Texture } from "three";

import type { ViewEvents } from "..";
import type { ThreeViewCamera } from "../camera";
import type { ViewContext } from "../core";
import type { DeclutterManager } from "../declutter";
import type { LayersManager } from "../layersManager";
import type { TileMesh } from "../mesh/tile";
import type { Scenes, TexturizedSceneByTileCoordinates } from "../scene";
import type { TextureOptions } from "../textures";
import type { TileTextureCompositor } from "../tileTexture";
import type {
  AbortControllers,
  MeshCache,
  WorkerPoolPromises,
  RenderFlag,
  TileMapByHandle,
} from "../type";
import type { CommonUniforms } from "../uniforms";
import type { TextureSlot } from "../utils";

import type { HillshadeContext } from "./HillshadeContext";

export type BufferLoader = {
  // The non-removing getters (u8/f32/f64/u32) return short-lived VIEWS into
  // WASM linear memory: consume them immediately and `.slice()` to retain —
  // any WASM call that allocates may grow the memory and detach the view.
  // Never hand their `.buffer` (the whole WASM memory) to another consumer.
  // Consecutive getter calls do not allocate, so earlier views stay valid.
  u8: (handle: number) => Uint8Array | null;
  f32: (handle: number) => Float32Array | null;
  f64: (handle: number) => Float64Array | null;
  u32: (handle: number) => Uint32Array | null;
  // The remove* variants return owned copies (the WASM-side buffer is freed).
  removeU8: (handle: number) => Uint8Array | null;
  removeF32: (handle: number) => Float32Array | null;
  removeF64: (handle: number) => Float64Array | null;
  removeU32: (handle: number) => Uint32Array | null;
  setU8: (handle: number, bits: bigint, bytes: Uint8Array) => void;
  newU8: (bytes: Uint8Array) => number | undefined;
  newU32: (bytes: Uint32Array) => number | undefined;
  newF32: (bytes: Float32Array) => number | undefined;
  newF64: (bytes: Float64Array) => number | undefined;
  // The `adopt*` variants register a JS-owned array in the `InMemoryBufferStore`
  // (zero-copy — the array is kept as-is) and hand WASM a byte-count-only
  // `External` handle, so worker-built geometry never round-trips through WASM
  // linear memory. The getters (u8/f32/...) return it directly; remove* takes it
  // and clears the WASM-side accounting.
  adoptU8: (array: Uint8Array) => number | undefined;
  adoptU32: (array: Uint32Array) => number | undefined;
  adoptF32: (array: Float32Array) => number | undefined;
  adoptF64: (array: Float64Array) => number | undefined;
  /** DataRequester mirror of `adoptU8`: registers an `External` entry under an
   * existing handle and fires the loaded event. Guards on `hasDataRequester`.
   * An `External` entry carries no element type, so this is not typed. */
  setExternal: (handle: number, bits: bigint, array: Uint8Array) => void;
  remove: (handle: number) => void;
  /** Evict handles Rust removed from the WASM `BufferStore` out of the JS-side
   * `InMemoryBufferStore`; called once per frame. */
  drainRemovedExternalHandles: () => void;
  triggerDataRequesterLoaded: (bits: bigint, handle: number) => void;
  triggerDataRequesterFailed: (bits: bigint) => void;
};

export type TextureFragmentHandler = {
  triggerTextureFragmentLoaded: (
    bits: bigint,
    status: TextureFragmentStatus,
  ) => void;
};

export type WorkerTaskHandler = {
  triggerWorkerTaskCompleted: (
    bits: bigint,
    result: DelegatedWorkerTasksResult,
  ) => void;
  /**
   * Release the delegator of a task that ended without a deliverable result.
   * Consumes `delegator_id`; a no-op for a task the engine already cancelled.
   */
  triggerWorkerTaskFailed: (delegator_id: ReconstructableEntity) => void;
  hasWorkerTask: (bits: bigint) => boolean;
};

export type TileHandler = {
  getMartini: (bits: ReconstructableEntity) => TransferableMartini | undefined;
  getTile: (handle: bigint) => TransferableTile | undefined;
  getTileElevationDecoder: (handle: bigint) => ElevationDecoder | undefined;
  /** Buffer handle of a tile's loaded raw DEM bytes, the data a raster-DEM
   * upsample of a descendant resamples from. */
  getTerrainDemBytes: (handle: bigint) => number | undefined;
  getVectorTileStates: (handle: bigint) => VectorTileState[] | undefined;
  vectorRevision: () => number;
  /** The WM raster tiles to bake into per-layer drape render targets for a
   * terrain tile (Geographic terrain only; empty on WebMercator terrain). */
  getRasterTileStates: (handle: bigint) => RasterTileState[] | undefined;
  rasterRevision: () => number;
  /** Reports a terrain tile's drape render-target GPU footprint (bytes) so the
   * memory ledger tracks clamp-to-ground vector bakes that scale with terrain
   * subdivision past the vector `maxZoom`. Pass 0 to release on dispose. */
  reportDrapeGpuBytes: (handle: bigint, bytes: number) => void;
  calcMetersPerTexel: (
    tileHandle: bigint,
    textureZoom: number,
    textureWidth: number,
  ) => number;
  /** Rust's clamped WebMercator northing (`navara_geometry::mercator_y`).
   * The composite paste derives its per-slot reprojection constants through
   * this so paste and bake (`uv_rect_from_extents_mercator`) share one
   * implementation — a drifting reimplementation misaligns the pasted
   * latitude band (and NaNs on the unclamped polar band). */
  mercatorY: (lat: number) => number;
};

/**
 * Handler for accessing individual Globe properties from WASM.
 * This provides a reference-based interface instead of copying the entire Globe object.
 */
export type GlobeHandler = {
  getTransparent: () => boolean | undefined;
  getMaxSse: () => number | undefined;
  getSegments: () => number | undefined;
  getColor: () => CoreColor | undefined;
  getHideUnderground: () => boolean | undefined;
  getUseNormal: () => boolean | undefined;
  getOpacity: () => number | undefined;
  getWireframe: () => boolean | undefined;
  getElevationColormap: () => Float32Array | undefined;
  setTransparent: (value: boolean) => void;
  setMaxSse: (value: number) => void;
  setSegments: (value: number) => void;
  setColor: (value: CoreColor) => void;
  setHideUnderground: (value: boolean) => void;
  setUseNormal: (value: boolean) => void;
  setOpacity: (value: number) => void;
  setWireframe: (value: boolean) => void;
  setElevationColormap: (value: ColorMap) => void;
};

export type FeatureHandler = {
  getTransferablePolygonBatchedFeature: (
    bits: bigint,
  ) => ReturnedTransferablePolygonBatchedFeature | undefined;
  getTransferablePolylineBatchedFeature: (
    bits: bigint,
  ) => ReturnedTransferablePolylineBatchedFeature | undefined;
  markFeatureIsRendered: (
    type: "point" | "polyline" | "polygon" | "model",
    bits: bigint,
  ) => void;
  /** Reports a rendered feature's actual measured GPU byte size so the memory
   * ledger replaces its payload-based estimate. Feature kinds the engine has
   * no owner lookup for are a no-op (currently wired: 3D Tiles models, whose
   * post-glTF/Draco-decode size undercounts otherwise). */
  reportFeatureGpuBytes: (bits: bigint, bytes: number) => void;
  readAllBatchedProperties(
    bits: bigint,
    callback: (
      batchIdx: number,
      batchId: number,
      properties?: Record<string, unknown>,
    ) => void,
  ): void;
  readFilteredBatchedProperties(
    bits: bigint,
    keys: string[],
    callback: (batchIdx: number, batchId: number, filtered?: unknown[]) => void,
  ): void;
};

export type MeshHandler = {
  setTileMeshPrepared: (handle: bigint) => void;
};

/** Settles the pending `flyTo` promise registered under `id`. */
export type FlightHandler = (id: number, completed: boolean) => void;

export type LayerHandler = {
  getLayerIndex: (layerId: string) => number | undefined;
};

type EventContextArgs = {
  eventManager: EventManager;
  scenes: Scenes;
  camera: ThreeViewCamera;
  meshes: MeshCache;
  abortControllers: AbortControllers;
  buf: BufferLoader;
  texFragment: TextureFragmentHandler;
  tileHandler: TileHandler;
  workerTaskHandler: WorkerTaskHandler;
  meshHandler: MeshHandler;
  featureHandler: FeatureHandler;
  loadedTexs: Map<string, Texture>;
  workerPoolPromises: WorkerPoolPromises;
  uniforms: CommonUniforms;
  texturizedSceneByTileCoordinates: TexturizedSceneByTileCoordinates;
  tileTextureCompositor: TileTextureCompositor;
  tileMapByHandle: TileMapByHandle;
  textureOptions: TextureOptions;
  renderFlag: RenderFlag;
  viewEvents: EventHandler<ViewEvents>;
  layersManager: LayersManager;
  viewContext: ViewContext;
  flightHandler: FlightHandler;
  layerHandler?: LayerHandler;
  fontManager?: FontManager;
  textureFragmentIndex?: Map<string, Set<TextureSlot>>;
  tileMeshToFragmentIds?: Map<TileMesh, Set<string>>;
  hillshadeContext?: HillshadeContext;
  declutter?: DeclutterManager;
};

/**
 * EventContext bundles all the shared state needed to process engine events
 * and propagate them into each processor.
 */
export class EventContext {
  readonly eventManager: EventManager;
  readonly scenes: Scenes;
  readonly camera: ThreeViewCamera;
  readonly meshes: MeshCache;
  readonly abortControllers: AbortControllers;
  readonly buf: BufferLoader;
  readonly texFragment: TextureFragmentHandler;
  readonly tileHandler: TileHandler;
  readonly workerTaskHandler: WorkerTaskHandler;
  readonly meshHandler: MeshHandler;
  readonly featureHandler: FeatureHandler;
  readonly loadedTexs: Map<string, Texture>;
  readonly workerPoolPromises: WorkerPoolPromises;
  readonly uniforms: CommonUniforms;
  readonly texturizedSceneByTileCoordinates: TexturizedSceneByTileCoordinates;
  readonly tileTextureCompositor: TileTextureCompositor;
  readonly tileMapByHandle: TileMapByHandle;
  readonly textureOptions: TextureOptions;
  readonly renderFlag: RenderFlag;
  readonly viewEvents: EventHandler<ViewEvents>;
  readonly layersManager: LayersManager;
  readonly viewContext: ViewContext;
  readonly flightHandler: FlightHandler;
  readonly layerHandler?: LayerHandler;
  readonly fontManager?: FontManager;
  readonly textureFragmentIndex?: Map<string, Set<TextureSlot>>;
  readonly tileMeshToFragmentIds?: Map<TileMesh, Set<string>>;
  readonly hillshadeContext?: HillshadeContext;
  /** Shared screen-space label declutterer; text/sprite meshes register as
   *  participants on creation. Optional so headless contexts can skip it. */
  readonly declutter?: DeclutterManager;

  updatedAt = 0;

  constructor(args: EventContextArgs) {
    this.eventManager = args.eventManager;
    this.scenes = args.scenes;
    this.camera = args.camera;
    this.meshes = args.meshes;
    this.abortControllers = args.abortControllers;
    this.buf = args.buf;
    this.texFragment = args.texFragment;
    this.tileHandler = args.tileHandler;
    this.workerTaskHandler = args.workerTaskHandler;
    this.meshHandler = args.meshHandler;
    this.featureHandler = args.featureHandler;
    this.loadedTexs = args.loadedTexs;
    this.workerPoolPromises = args.workerPoolPromises;
    this.uniforms = args.uniforms;
    this.texturizedSceneByTileCoordinates =
      args.texturizedSceneByTileCoordinates;
    this.tileTextureCompositor = args.tileTextureCompositor;
    this.tileMapByHandle = args.tileMapByHandle;
    this.textureOptions = args.textureOptions;
    this.renderFlag = args.renderFlag;
    this.viewEvents = args.viewEvents;
    this.layersManager = args.layersManager;
    this.viewContext = args.viewContext;
    this.flightHandler = args.flightHandler;
    this.layerHandler = args.layerHandler;
    this.fontManager = args.fontManager;
    this.textureFragmentIndex = args.textureFragmentIndex;
    this.tileMeshToFragmentIds = args.tileMeshToFragmentIds;
    this.hillshadeContext = args.hillshadeContext;
    this.declutter = args.declutter;
  }
}
