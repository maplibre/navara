import type { TileHandle } from "@navaramap/core";
import type {
  Color,
  Texture,
  Vector2,
  Vector4,
  WebGLRenderTarget,
} from "three";

import type { ColorRampRow } from "../colorMapAtlas";

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
   * the elevation heatmap decode samples the reprojected per-slot UV, so a DEM draped on
   * Geographic terrain (baked or direct) remaps identically to color imagery.
   */
  reproject?: [number, number];
  /**
   * Texture filtering mode for the elevation data.
   * "linear" uses bilinear interpolation, "nearest" uses nearest neighbor.
   */
  filter?: "linear" | "nearest";
  /**
   * The layer's color ramp in the colorMap atlas (row, stop count, and whether
   * the layer set `colorStops`). Each elevation heatmap layer has its own row.
   */
  colorRamp?: ColorRampRow;
  /**
   * Minimum height for elevation normalization (meters).
   * Heights below this value map to the start of the colorMap.
   */
  minHeight?: number;
  /**
   * Maximum height for elevation normalization (meters).
   * Heights above this value map to the end of the colorMap.
   */
  maxHeight?: number;
  /**
   * Whether to apply logarithmic scaling to this layer.
   * Enables more nuanced visualization of low-elevation areas when the elevation range is large.
   */
  logarithmic?: boolean;
  /**
   * Boundary value for pseudo-logarithmic scaling.
   * Values between -logBoundary and +logBoundary are scaled linearly; values outside
   * this range use logarithmic scaling. Only used when logarithmic is true.
   */
  logBoundary?: number;
  /**
   * DEM decoder parameters (r_scaler, g_scaler, b_scaler, boundary) for this layer's source.
   * Each elevation heatmap layer can use a different DEM encoding (Terrarium, Mapbox, etc.).
   */
  rgbScalersAndBoundary?: Vector4;
  /**
   * DEM decoder offset parameters (minOffset, maxOffset, epsilon, offset) for this layer's source.
   */
  decoderOffsets?: Vector4;
};

/**
 * Pseudo-log boundary used when an elevation heatmap enables `logarithmic`
 * without a usable `logBoundary` (matches Rust's default). The boundary must
 * be > 1: the shader divides by ln(logBoundary).
 */
export const DEFAULT_ELEVATION_HEATMAP_LOG_BOUNDARY = 10;

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
};
