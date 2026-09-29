import type { NormalizeWASMClass, TileHandle } from "@navaramap/core";
import type {
  VectorLayerDescription,
  RasterLayerDescription,
  TerrainSourceLayerDescription,
  Tiles3dLayerDescription,
  GeoJsonSourceDescription,
  VectorTileSourceDescription,
  RasterTileSourceDescription,
  RasterDemSourceDescription,
  QuantizedMeshSourceDescription,
  Tiles3dSourceDescription,
  SourceDescription as SourceDescriptionImpl,
} from "@navaramap/engine";
import type { Promise as WorkerPoolPromise } from "@navaramap/worker";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Mesh, Sprite, Object3D } from "three";

import type { Color } from "../Color";
import type { FeatureInfo } from "../evaluations";
import type {
  FinalCopyPassConfig,
  MRTPassConfig,
  SkyEnvMapPassConfig,
  TransparentPassConfig,
} from "../layers/effect";
import type { TileMesh } from "../mesh";
import type { Source } from "../source";

export type { Promise as WorkerPoolPromise } from "@navaramap/worker";

export type Descriptions = {
  mesh?: object;
  light?: object;
  effect?: object;
};

export type EmptyDescriptions = {
  mesh: undefined;
  light: undefined;
  effect: undefined;
};

export type OmitType<T> = T extends unknown ? Omit<T, "type"> : never;

export type BuiltInEffectDescription =
  | FinalCopyPassConfig
  | MRTPassConfig
  | SkyEnvMapPassConfig
  | TransparentPassConfig;

type Layer<LD> = NormalizeWASMClass<LD>;

/**
 * Helper type to add Navara Color object support to color-related number fields.
 * This recursively transforms any field named 'color' or ending with 'Color'
 * to accept both number and Navara Color objects.
 */
type ConvertColorFields<T> = {
  [K in keyof T]: K extends `${string}Color` | "color"
    ? T[K] extends number | undefined
      ? Color | undefined
      : T[K] extends number
        ? Color
        : T[K]
    : T[K] extends object | undefined
      ? ConvertColorFields<T[K]> | Extract<T[K], undefined>
      : T[K];
};

/**
 * Helper type to enable Navara Color objects in all color-related fields.
 * This applies to model, point, billboard, text, polyline, polygon, raster, etc.
 * Both number and Navara Color objects are accepted for backward compatibility.
 */
type WithColorSupport<T> = ConvertColorFields<T>;

/**
 * Source geometry categories a vector appearance can consume via its
 * `geometryTypes` option. Each appearance defaults to its native geometry only
 * (`"point"` for point/billboard/text, `"line"` for polyline); adding entries
 * derives extra representations, e.g. `polyline: { geometryTypes: ["line",
 * "polygon"] }` also renders polygon boundary rings as polylines.
 */
export type SourceGeometryType = "point" | "line" | "polygon";

/**
 * Whether a label or sprite stands up (`"upright"`, the default) or lies on
 * the globe surface around its anchor (`"flat"`), following its curvature so
 * it reads as painted on the surface. The value of `textFacing` / `billboardFacing` / `pointFacing`.
 * Pair with `rotateWithCamera`, which chooses whether the quad turns to
 * follow the camera or stays frozen in the anchor's east-north-up frame.
 */
export type Facing = "upright" | "flat";

/** @deprecated Use {@link Facing}, which covers all three material types. */
export type TextFacing = Facing;

/**
 * Helper type to narrow the material fields that wasm-bindgen generates as
 * bare `string`s to their literal unions. One recursive pass covers them all.
 */
type ConvertStringUnionFields<T> = {
  [K in keyof T]: K extends "geometryTypes"
    ? SourceGeometryType[] | Extract<T[K], undefined>
    : K extends "textFacing" | "billboardFacing" | "pointFacing"
      ? Facing | Extract<T[K], undefined>
      : T[K] extends object | undefined
        ? ConvertStringUnionFields<T[K]> | Extract<T[K], undefined>
        : T[K];
};

/**
 * A reference to a {@link Source}: either the source handle returned by
 * `addSource`, or its `id` string.
 */
export type SourceRef = string | Source;

export type SourceLayerBase<Layer extends { source?: string | undefined }> =
  Omit<Layer, "source"> & {
    source?: SourceRef;
  };

type VectorLayerBase = WithColorSupport<
  ConvertStringUnionFields<Layer<VectorLayerDescription & { type: "vector" }>>
>;

/**
 * A `vector` layer renders a `geojson` or `vector-tile` source as points,
 * lines, polygons, text and billboards.
 */
export type VectorLayer = SourceLayerBase<VectorLayerBase>;

type RasterLayerBase = WithColorSupport<
  Layer<RasterLayerDescription & { type: "raster" }>
>;

/** A `raster` layer renders a `raster-tile` (imagery) or `raster-dem` source. */
export type RasterLayer = SourceLayerBase<RasterLayerBase>;

type TerrainSourceLayerBase = WithColorSupport<
  Layer<TerrainSourceLayerDescription & { type: "terrain" }>
>;

/**
 * A `terrain` layer renders a `raster-dem` or `quantized-mesh` source as the
 * globe surface. Alternatively, omit `source` and pass `ellipsoid` to render a
 * flat ellipsoid surface (e.g. to drape clamp-to-ground data on).
 */
export type TerrainSourceLayer = SourceLayerBase<TerrainSourceLayerBase> & {
  /** Render a source-less flat ellipsoid surface. Mutually exclusive with `source`. */
  ellipsoid?: TerrainSourceLayerBase["terrain"];
};

type Tiles3dLayerBase = WithColorSupport<
  Layer<Tiles3dLayerDescription & { type: "3d-tiles" }>
>;

/** A `3d-tiles` layer renders a `3d-tiles`, `b3dm`, or `pnts` source. */
export type Tiles3dLayer = SourceLayerBase<Tiles3dLayerBase>;

export type LayerDescription =
  VectorLayer | RasterLayer | TerrainSourceLayer | Tiles3dLayer;

/**
 * Fields common to every source, independent of its `type`.
 *
 * An optional `id` may be given; when omitted a random id is generated. Adding a
 * source with an existing id overrides it (later definition wins). Combined with
 * referencing a source by its id string from a layer, this enables defining the
 * whole map declaratively (MapLibre-style) from JSON.
 */
export type SourceBase = Omit<
  NormalizeWASMClass<SourceDescriptionImpl>,
  "type"
>;

/** A `geojson` source: inline GeoJSON, or GeoJSON fetched from a `url`. */
export type GeoJsonSource = SourceBase &
  Omit<
    WithColorSupport<Layer<GeoJsonSourceDescription & { type: "geojson" }>>,
    "data"
  > & {
    /** Inline GeoJSON. Use `url` instead to fetch from a URL. */
    data?: FeatureCollection | Feature | Geometry;
  };

/** A `vector-tile` source: Mapbox Vector Tiles fetched from a `url` template. */
export type VectorTileSource = SourceBase &
  WithColorSupport<
    Layer<VectorTileSourceDescription & { type: "vector-tile" }>
  >;

/** A `raster-tile` source: raster imagery tiles fetched from a `url` template. */
export type RasterTileSource = SourceBase &
  WithColorSupport<
    Layer<RasterTileSourceDescription & { type: "raster-tile" }>
  >;

/** A `raster-dem` source: RGB-encoded elevation tiles fetched from a `url` template. */
export type RasterDemSource = SourceBase &
  WithColorSupport<Layer<RasterDemSourceDescription & { type: "raster-dem" }>>;

/** A `quantized-mesh` source: Cesium quantized-mesh terrain tiles. */
export type QuantizedMeshSource = SourceBase &
  WithColorSupport<
    Layer<QuantizedMeshSourceDescription & { type: "quantized-mesh" }>
  >;

/** A `3d-tiles` source: a 3D Tiles tileset (`tileset.json`). */
export type Tiles3dSource = SourceBase &
  WithColorSupport<Layer<Tiles3dSourceDescription & { type: "3d-tiles" }>>;

/** A `b3dm` source: a single Batched 3D Model tile. */
export type B3dmSource = SourceBase &
  WithColorSupport<Layer<Tiles3dSourceDescription & { type: "b3dm" }>>;

/** A `pnts` source: a single Point Cloud tile. */
export type PntsSource = SourceBase &
  WithColorSupport<Layer<Tiles3dSourceDescription & { type: "pnts" }>>;

/**
 * A source describes where data comes from and how it is fetched/decoded.
 * Register one with `addSource` and reference it from layers by handle or id.
 *
 * This is the discriminated union of every per-type source description
 * ({@link GeoJsonSource}, {@link QuantizedMeshSource}, ...); use an individual
 * member type when you only accept one source type.
 */
export type SourceDescription =
  | GeoJsonSource
  | VectorTileSource
  | RasterTileSource
  | RasterDemSource
  | QuantizedMeshSource
  | Tiles3dSource
  | B3dmSource
  | PntsSource;

export type MeshCache = Map<string, Mesh | Sprite | Object3D>;

// Make a reference of TileMesh by TileHandle.
export type TileMapByHandle = Map<TileHandle, TileMesh>;

export type AbortControllers = Map<string, AbortController>;

export type WorkerPoolPromises = Map<string, WorkerPoolPromise<unknown>>;

export type PickedFeature = FeatureInfo;

export type RenderFlag = {
  forceUpdate: boolean;
  animation: boolean;
};
