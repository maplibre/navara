import type { EventHandler, FeatureSetId } from "@navaramap/core";
import type { Object3D } from "three";

import { ModelMesh, type ViewEvents } from "..";
import { FeatureEvaluator } from "../evaluations";
import { Layer } from "../layer";
import { LayersManager } from "../layersManager";

import type { FeatureHandler } from ".";

export const handleFeatureCreatedEventByLayerId = (
  handler: FeatureHandler,
  obj: Object3D,
  viewEvents: EventHandler<ViewEvents>,
  layersManager: LayersManager,
  layerId: string,
  featureSetId: FeatureSetId,
) => {
  const layer = layersManager.get(layerId);

  // Create the evaluator
  const evaluator = new FeatureEvaluator(handler, layerId, featureSetId, obj);

  const model = obj instanceof ModelMesh ? obj : undefined;

  // Register the feature evaluator with the layer if it exists
  if (layer && layer instanceof Layer) {
    layer._registerFeatureEvaluator(featureSetId, evaluator, model);
  }

  // Emit the evaluator
  viewEvents.emit("layer", "featureCreated", layerId, {
    featureSetId,
    evaluator,
    // Built only when a listener reads it.
    get content() {
      return model?.content;
    },
  });

  return layer;
};

export const handleFeatureUpdatedEventByLayerId = (
  viewEvents: EventHandler<ViewEvents>,
  layersManager: LayersManager,
  layerId: string,
  featureSetId: FeatureSetId,
  updatedAt: number,
) => {
  const layer = layersManager.get(layerId);

  if (!layer) return;

  // Get the existing evaluator or create a new one
  if (!(layer instanceof Layer)) return;
  const evaluator = layer._getFeatureEvaluator(featureSetId);
  if (!evaluator) return;

  // Emit the event with the evaluator
  viewEvents.emit("layer", "featureUpdated", layerId, {
    featureSetId,
    evaluator,
    updatedAt,
  });
};

export const handleFeatureVisibilityChangedEventByLayerId = (
  layersManager: LayersManager,
  layerId: string,
  featureSetId: FeatureSetId,
  visible: boolean,
) => {
  const layer = layersManager.get(layerId);

  if (!layer) return;
  if (!(layer instanceof Layer)) return;

  // Emit the visibility changed event
  layer.emit("featureVisibilityChanged", { featureSetId, visible });
};
