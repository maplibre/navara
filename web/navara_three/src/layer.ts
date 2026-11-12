import { EventHandler, type FeatureSetId } from "@navaramap/core";
import type { Core } from "@navaramap/engine";

import { FeatureEvaluator } from "./evaluations";
import { Source } from "./source";
import type { LayerDescription } from "./type";

export type FeatureCreatedParams = {
  featureSetId: FeatureSetId;
  evaluator: FeatureEvaluator;
  credit?: string;
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
export class Layer extends EventHandler<LayerEvent> {
  /** The unique identifier of this layer. */
  id: string;
  private core: Core;
  private featureEvaluators: Map<FeatureSetId, FeatureEvaluator> = new Map<
    FeatureSetId,
    FeatureEvaluator
  >();
  private needUpdate = false;
  private convertColors?: (obj: unknown) => unknown;

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
   * Register a feature evaluator with this layer
   * @internal Used by the event system
   */
  _registerFeatureEvaluator(
    featureSetId: FeatureSetId,
    evaluator: FeatureEvaluator,
  ) {
    this.featureEvaluators.set(featureSetId, evaluator);
  }

  /**
   * Get a feature evaluator by ID
   * @internal Used by the event system
   */
  _getFeatureEvaluator(
    featureSetId: FeatureSetId,
  ): FeatureEvaluator | undefined {
    return this.featureEvaluators.get(featureSetId);
  }

  /**
   * Unregister a feature evaluator from this layer
   * @internal Used by the event system
   */
  _unregisterFeatureEvaluator(featureSetId: FeatureSetId) {
    this.featureEvaluators.delete(featureSetId);
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
    for (const evaluator of this.featureEvaluators.values()) {
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
  }
}
