import type { TileHandle } from "@navaramap/core";
import type {
  Color,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";

/**
 * A mesh drawn into a vector drape bake. A bake material always blends, so
 * `drapeTransparent` keeps the material's `transparent` option, one of the
 * signals `TileScene.hasTransparentMesh` reads: only a translucent layer
 * needs its overlapping sources clipped (see
 * `TileTextureCompositor.renderVectorScenes`).
 */
export type DrapeBakedMesh = { drapeTransparent: boolean };

/**
 * Why a tile's composite atlas needs to be re-rendered.
 * Aggregated per-handle so a single composite pass services multiple updates.
 */
export type DirtyReason =
  | "material"
  | "texture-binding"
  | "vector-revision"
  | "raster-revision"
  | "hillshade";

/**
 * A composite atlas is a single MRT render target (count=3) with three named
 * attachments:
 * - color: composited diffuse (sRGB)
 * - attr:  packed per-pixel material attributes (water flag/scale/speed, …)
 * - normal: hillshade normal map in [0,1] (neutral 0.5,0.5,1 when no hillshade)
 *
 * One draw call writes all three; the main TileMesh shader samples them
 * independently as Textures.
 */
export type CompositeAtlas = {
  readonly target: WebGLRenderTarget;
  readonly color: Texture;
  readonly attr: Texture;
  readonly normal: Texture;
  dispose: () => void;
};

/** Creates the per-tile MRT trio. Injected so tests can supply fakes. */
export type AtlasFactory = (size: number) => CompositeAtlas;

/**
 * View on the atlas suitable for binding as TileMesh uniforms.
 * Same Textures live across the atlas's lifetime; only `needsUpdate` flips.
 */
export type CompositeOutputs = {
  color: Texture;
  attr: Texture;
  normal: Texture;
};

/** Features detected from the Rust material — drives CPU shader branch elision. */
export type CompositeFeatures = {
  hasHillshade: boolean;
  hasWater: boolean;
  hasElevationHeatmap: boolean;
  /**
   * Quantized-mesh watermask is present. Sampled once after the slot loop
   * and OR'd into `isWater` so it takes priority even when no per-slot
   * `uWaters[k]` is set. Independent of `hasWater` (per-slot flag path).
   */
  hasWatermask: boolean;
};

/** A handle's cache entry. Public surface is via TileTextureCache methods. */
export type CacheEntry = {
  readonly handle: TileHandle;
  readonly atlas: CompositeAtlas;
  refCount: number;
  dirty: Set<DirtyReason>;
};

// ---------------------------------------------------------------------------
// Composite domain model
//
// Typed replacement for the parallel-array bridge (shows[]/colors[]/
// isHillshades[]/… read out of material.userData). Each active layer is one
// self-describing record; the SlotPlanner flattens them into compact slots and
// the composite layer enhancers consume them. `region` keeps the existing
// raster/vector split (the compact-slot space skips the gap between them) and
// drives the compile-time `isTexturized` constant.
// ---------------------------------------------------------------------------

/** Which compact-slot region a layer lives in (raster low indices vs vector). */
export type CompositeLayerRegion = "raster" | "vector";

type CompositeLayerBase = {
  /**
   * Absolute slot index into the TileMesh main shader's per-slot uniform
   * arrays. Baked into the atlas as the winning slot so the main shader can
   * look the layer's precision-sensitive attrs back up.
   */
  absSlot: number;
  region: CompositeLayerRegion;
  texture: Texture | null;
  uvOffset: Vector2;
  uvScale: Vector2;
};

/** A sampled color layer — a raster tile or a texturized vector scene. */
export type RasterCompositeLayer = CompositeLayerBase & {
  kind: "raster";
  color: Color;
  opacity: number;
  water: boolean;
  /**
   * `[south, north]` latitude (radians) of the terrain tile when this slot is a
   * WebMercator raster draped on Geographic terrain — the composite shader uses
   * it to reproject the latitude axis (Mercator). `undefined` for same-scheme
   * drapes (no reprojection).
   */
  reproject?: [number, number];
};

/** A DEM-derived normal map; contributes no color, only a hillshade normal. */
export type HillshadeCompositeLayer = CompositeLayerBase & {
  kind: "hillshade";
};

/** A DEM elevation raster colorized through the shared colormap. */
export type ElevationHeatmapCompositeLayer = CompositeLayerBase & {
  kind: "elevationHeatmap";
  opacity: number;
  /**
   * Same Mercator latitude reprojection band as {@link RasterCompositeLayer}:
   * the heatmap decode samples the reprojected per-slot UV, so a DEM draped on
   * Geographic terrain (baked or direct) remaps identically to color imagery.
   */
  reproject?: [number, number];
};

export type CompositeLayer =
  | RasterCompositeLayer
  | HillshadeCompositeLayer
  | ElevationHeatmapCompositeLayer;

/**
 * Tile-wide inputs that are not per-slot. Kept separate from CompositeLayer so
 * adding a new per-layer expression doesn't bloat a shared struct (and vice
 * versa). Consumed by the layer enhancers that own slot-independent uniforms.
 */
export type CompositeGlobals = {
  /** Hillshade normal exaggeration (shared across hillshade layers). */
  hillshadeExaggeration: number;
  /** Quantized-mesh watermask (1×1 uniform or 256×256), or null. */
  watermask: Texture | null;
  /** Elevation heatmap colormap ramp, or null. */
  colorMapTexture: Texture | null;
  /** Elevation heatmap shared decoder params. */
  elevationRGBScaler: Vector3;
  elevationMinMaxHeightAndBoundary: Vector3;
  elevationMinMaxOffsetAndEpsilonAndOffset: Vector4;
  logarithmic: boolean;
  logBase: number;
  logBoundary: number;
};
