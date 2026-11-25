import { EventHandler, type FeatureSetId } from "@navaramap/core";
import type { Core } from "@navaramap/engine";

import { FeatureEvaluator } from "./evaluations";
import { Source } from "./source";
import type { LayerDescription } from "./type";

/**
 * A 3D Tiles 1.1 metadata entity. Values are in their final form: `normalized`,
 * `offset` and `scale` are applied, a `noData` value is replaced by the
 * property's `default` (or `null`), and an omitted property with a `default`
 * is filled in. Enum values are names.
 */
export type Tiles3dMetadataEntity = {
  /** Class ID in the tileset schema. */
  class: string;
  properties: Record<string, unknown>;
};

/**
 * 3D Tiles 1.1 metadata of the tile, content and group a feature set was
 * loaded from. Only the entities the tileset defines are present.
 */
export type Tiles3dContentMetadata = {
  tile?: Tiles3dMetadataEntity;
  content?: Tiles3dMetadataEntity;
  group?: Tiles3dMetadataEntity;
};

/** The root tileset JSON of a `3d-tiles` layer. */
export type Tiles3dTileset = {
  /** The tileset's own metadata entity. */
  metadata?: Tiles3dMetadataEntity;
  /** The `schema` object of the tileset JSON. */
  schema?: Record<string, unknown>;
};

/** The 3D Tiles content a feature set was loaded from. */
export type Tiles3dFeatureSetContent = {
  type: "3d-tiles";
  /** `asset.copyright` of the content's glTF. */
  credit?: string;
  /** 3D Tiles 1.1 metadata, when the tileset defines any. */
  metadata?: Tiles3dContentMetadata;
};

/**
 * The source content a feature set was loaded from, discriminated by `type`.
 * More data formats may be added.
 */
export type FeatureSetContent = Tiles3dFeatureSetContent;

export type FeatureCreatedParams = {
  featureSetId: FeatureSetId;
  evaluator: FeatureEvaluator;
  /** `undefined` when the feature set has no source content information. */
  content?: FeatureSetContent;
};

export type FeatureUpdatedParams = {
  featureSetId: FeatureSetId;
  evaluator: FeatureEvaluator;
  updatedAt: number;
};

export type FeatureVisibilityChangedParams = {
  featureSetId: FeatureSetId;
  visible: boolean;
};

export type FeatureRemovedParams = {
  featureSetId: FeatureSetId;
};

/**
 * Events emitted by Layer. Subscribe using `layer.on(eventName, callback)`.
 */
export type LayerEvent = {
  /** Emitted when a new feature is created in this layer. */
  featureCreated: (params: FeatureCreatedParams) => void;
  /** Emitted when a feature in this layer is updated. */
  featureUpdated: (params: FeatureUpdatedParams) => void;
  /** Emitted when a feature's visibility changes. */
  featureVisibilityChanged: (params: FeatureVisibilityChangedParams) => void;
  /** Emitted when a feature is removed from this layer. */
  featureRemoved: (params: FeatureRemovedParams) => void;
  /**
   * Emitted when a `3d-tiles` layer loads its root tileset JSON, again after
   * a source update reloads it. Also readable as {@link Layer.tileset}.
   */
  tilesetLoaded: (tileset: Tiles3dTileset) => void;
  /**
   * Emitted after `update()` sends a new configuration to the engine, with the
   * configuration as passed to `update()`.
   */
  updated: (l: LayerDescription) => void;
  /** Emitted when the layer is deleted. */
  deleted: () => void;
};

/**
 * An explicit `colorMap: undefined` / `colorStops: undefined` clears that
 * array, but `undefined` is dropped when the description crosses into Rust,
 * which would then keep the old hash and skip re-compositing. Forward the clear
 * as an empty array instead: Rust hashes it (a changed hash re-composites the
 * layer's tiles), and the web side (`_syncColorMap`) treats it as no array.
 */
function withExplicitColorRampClears(l: LayerDescription): LayerDescription {
  if (l.type !== "raster" || !l.elevationHeatmap) return l;
  const elevationHeatmap = { ...l.elevationHeatmap };
  let changed = false;
  for (const key of ["colorMap", "colorStops"] as const) {
    if (key in elevationHeatmap && elevationHeatmap[key] === undefined) {
      elevationHeatmap[key] = new Float32Array(0);
      changed = true;
    }
  }
  return changed ? { ...l, elevationHeatmap } : l;
}

/**
 * A handle to control a resource layer (e.g., imagery, terrain, GeoJSON, 3D Tiles) after it has been added to the scene.
 * Returned by `ThreeView.addLayer()` when adding resource layers (not mesh, light, or effect descriptors).
 *
 * Resource layers are data-driven layers that load and display geographic data from external sources.
 * Use this handle to update layer configuration or delete the layer.
 *
 * @example
 * ```typescript
 * // Register a GeoJSON source, then render it with a vector layer
 * const geoJsonSource = view.addSource({
 *   type: "geojson",
 *   url: "https://example.com/data.geojson",
 * });
 * const geoJsonLayer = view.addLayer({
 *   type: "vector",
 *   source: geoJsonSource,
 *   point: { color: 0xff0000 }
 * });
 *
 * // Update the layer configuration
 * geoJsonLayer.update({ point: { color: 0x00ff00 } });
 *
 * // Listen to feature events
 * geoJsonLayer.on("featureCreated", ({ evaluator }) => {
 *   console.log("Feature created:", evaluator);
 * });
 *
 * // Delete the layer
 * geoJsonLayer.delete();
 * ```
 */
type FeatureSetEntry = {
  evaluator: FeatureEvaluator;
  contentSource?: { readonly content: FeatureSetContent | undefined };
};

export class Layer extends EventHandler<LayerEvent> {
  /** The unique identifier of this layer. */
  id: string;
  private core: Core;
  private featureSets = new Map<FeatureSetId, FeatureSetEntry>();
  private needUpdate = false;
  private convertColors?: (obj: unknown) => unknown;
  private _tileset: Tiles3dTileset | undefined;

  constructor(
    id: string,
    core: Core,
    convertColors?: (obj: unknown) => unknown,
  ) {
    super();

    this.id = id;
    this.core = core;
    this.convertColors = convertColors;
  }

  /**
   * The root tileset JSON of a `3d-tiles` layer, once loaded (see the
   * `tilesetLoaded` event). `undefined` while a source update reloads it, and
   * for other layer types.
   */
  get tileset(): Tiles3dTileset | undefined {
    return this._tileset;
  }

  /** @internal Used by the event system */
  _setTileset(tileset: Tiles3dTileset | undefined) {
    this._tileset = tileset;
  }

  /**
   * Register a feature evaluator with this layer
   * @internal Used by the event system
   */
  _registerFeatureEvaluator(
    featureSetId: FeatureSetId,
    evaluator: FeatureEvaluator,
    contentSource?: { readonly content: FeatureSetContent | undefined },
  ) {
    this.featureSets.set(featureSetId, { evaluator, contentSource });
  }

  /**
   * The source content a live feature set was loaded from, as in its
   * `featureCreated` event. `undefined` once the feature set is removed.
   */
  getFeatureSetContent(
    featureSetId: FeatureSetId,
  ): FeatureSetContent | undefined {
    return this.featureSets.get(featureSetId)?.contentSource?.content;
  }

  /**
   * Get a feature evaluator by ID
   * @internal Used by the event system
   */
  _getFeatureEvaluator(
    featureSetId: FeatureSetId,
  ): FeatureEvaluator | undefined {
    return this.featureSets.get(featureSetId)?.evaluator;
  }

  /**
   * Unregister a feature evaluator from this layer
   * @internal Used by the event system
   */
  _unregisterFeatureEvaluator(featureSetId: FeatureSetId) {
    this.featureSets.delete(featureSetId);
  }

  /**
   * Process feature updates for all registered features
   * @internal Used by the animation loop
   */
  _processFeatureUpdates(updatedAt: number) {
    if (!this.needUpdate) {
      return false;
    }
    this.needUpdate = false;

    // Process all evaluators with the registered callbacks
    for (const { evaluator } of this.featureSets.values()) {
      this.emit("featureUpdated", {
        featureSetId: evaluator.id,
        evaluator,
        updatedAt,
      });
    }

    return true;
  }

  /**
   * Marks the layer for update on the next frame.
   * Call this when you need to trigger `featureUpdated` events.
   */
  forceUpdate() {
    this.needUpdate = true;
  }

  /**
   * Updates the layer configuration.
   * The entire configuration is replaced with the new values.
   * @param l - New layer configuration
   */
  update(l: LayerDescription) {
    const desc = withExplicitColorRampClears(l);
    const normalized =
      "source" in desc && desc.source instanceof Source
        ? { ...desc, source: desc.source.id }
        : desc;
    // Convert Color objects to numbers if converter is provided
    const processedLayer = this.convertColors
      ? (this.convertColors(normalized) as LayerDescription)
      : normalized;
    this.core.updateLayer(this.id, processedLayer);
    this.emit("updated", l);
  }

  /**
   * Removes the layer from the scene and disposes its resources.
   * Emits the "deleted" event before cleanup.
   * After calling this, the layer should no longer be used.
   */
  delete() {
    this.core.deleteLayer(this.id);
    this.emit("deleted");
    // Removal events arrive after the layer left the manager, so they can't
    // unregister its feature sets.
    this.featureSets.clear();
  }
}
