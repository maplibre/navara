import {
  generate_id_from_entity,
  type RegisteredJobKind,
} from "@navaramap/core";
import {
  type Transform,
  type ObjectTransformEvent,
  type CameraFrustum,
  type TilesetLoadedEvent,
  Events,
} from "@navaramap/engine";
import { radianToDegree } from "@navaramap/three-api";
import { Object3D } from "three";

import { Layer, type Tiles3dTileset } from "../layer";

import { type EventContext } from "./context";
import { dataRequesterJobHandler } from "./dataRequester";
import { renderableFeatureJobHandler } from "./feature";
import {
  processHillshadeBackfilled,
  processHillshadeCanceled,
} from "./hillshade";
import { textureFragmentJobHandler } from "./textureFragment";
import {
  processMeshGeometryReplaced,
  processTerrainExaggerationUpdated,
  processVectorDrapeChanged,
  tileMeshJobHandler,
} from "./tile";
import { workerTaskJobHandler } from "./worker";

export type {
  BufferLoader,
  TextureFragmentHandler,
  WorkerTaskHandler,
  TileHandler,
  GlobeHandler,
  FeatureHandler,
  MeshHandler,
  LayerHandler,
  FlightHandler,
} from "./context";
export { EventContext } from "./context";
export { HillshadeContext } from "./HillshadeContext";

/**
 * Wire every engine event kind into the context's dispatcher. Sync handlers
 * run in registration order at the start of each tick; job handlers follow.
 * Returns the delegated worker task kind, whose in-flight jobs each hold one
 * pool task.
 */
export function registerEventHandlers(ctx: EventContext): {
  workerTasks: RegisteredJobKind;
} {
  const { dispatcher, viewEvents } = ctx;

  dispatcher.registerSync("terrain_exaggeration_updated", (ev) =>
    processTerrainExaggerationUpdated(ctx, ev),
  );
  dispatcher.registerSync("camera_transform_updated", (ev) =>
    processCameraTransformUpdated(ctx, ev),
  );
  dispatcher.registerSync("camera_frustum_updated", (ev) =>
    processCameraFrustumUpdated(ctx, ev),
  );
  dispatcher.registerSync("camera_flight_ended", (ev) =>
    ctx.flightHandler(ev.id, ev.completed),
  );
  dispatcher.registerSync("object_transform_updated", (ev) =>
    processObjectTransformUpdated(ctx, ev),
  );
  // Geometry-only swaps (an upsampled terrain mesh replaced by its real DEM)
  // are applied synchronously here, alongside the transform update above, so
  // the mesh never renders new geometry at an old RTC origin or vice versa.
  dispatcher.registerSync("mesh_geometry_replaced", (ev) =>
    processMeshGeometryReplaced(ctx, ev),
  );
  dispatcher.registerSync("update_sample_terrain_height", (ev) =>
    viewEvents.emit("_sample_terrain_height_received", ev),
  );
  dispatcher.registerSync("update_terrain_height_range", (ev) =>
    viewEvents.emit("_terrain_height_range_received", ev),
  );
  dispatcher.registerSync("hillshade_canceled", (ev) =>
    processHillshadeCanceled(ctx, ev),
  );
  dispatcher.registerSync("hillshade_backfilled", (ev) =>
    processHillshadeBackfilled(ctx, ev),
  );
  dispatcher.registerSync("vector_drape_changed", (handles) =>
    processVectorDrapeChanged(ctx, handles),
  );
  // Before `tileset_loaded`: a reload's new tileset must not be cleared.
  dispatcher.registerSync("tileset_unloaded", (layerId) => {
    const layer = ctx.layersManager.get(layerId);
    if (layer instanceof Layer) layer._setTileset(undefined);
  });
  dispatcher.registerSync("tileset_loaded", (ev) =>
    processTilesetLoaded(ctx, ev),
  );

  dispatcher.register(tileMeshJobHandler(ctx));
  const workerTasks = dispatcher.register(workerTaskJobHandler(ctx));
  dispatcher.register(renderableFeatureJobHandler(ctx));
  dispatcher.register(textureFragmentJobHandler(ctx));
  dispatcher.register(dataRequesterJobHandler(ctx));
  return { workerTasks };
}

export function processEvent(ctx: EventContext, event: Events | undefined) {
  ctx.dispatcher.tick(event);
}

function processCameraTransformUpdated(
  ctx: EventContext,
  transform: Transform | undefined,
) {
  if (!transform) return;
  setTransform(ctx.camera.raw, transform);

  ctx.camera.updateStatus();
}

function processCameraFrustumUpdated(
  ctx: EventContext,
  frustum: CameraFrustum | undefined,
) {
  if (!frustum) return;

  ctx.camera.raw.near = frustum.near;
  ctx.camera.raw.far = frustum.far;
  // The engine's `fov` is the vertical fov, matching what
  // `PerspectiveCamera.fov` expects.
  ctx.camera.raw.fov = radianToDegree(frustum.fov);
  ctx.camera.raw.updateProjectionMatrix();
  ctx.camera.emit("frustumChanged");
}

function processTilesetLoaded(ctx: EventContext, ev: TilesetLoadedEvent) {
  const layer = ctx.layersManager.get(ev.layer_id);
  if (!(layer instanceof Layer)) return;
  const { metadata, schema } = ev;
  const tileset: Tiles3dTileset = {
    metadata: metadata ? JSON.parse(metadata) : undefined,
    schema: schema ? JSON.parse(schema) : undefined,
  };
  layer._setTileset(tileset);
  ctx.viewEvents.emit("layer", "tilesetLoaded", ev.layer_id, tileset);
}

function processObjectTransformUpdated(
  ctx: EventContext,
  e: ObjectTransformEvent,
) {
  const id = generate_id_from_entity(e);
  const m = ctx.meshes.get(id);
  if (m) {
    setTransform(m, e.transform);
  }
}

export function setTransform(
  obj: Object3D,
  transform: Transform,
  keepPosition?: boolean,
) {
  const { tx, ty, tz, qx, qy, qz, qw, sx, sy, sz } = transform;
  if (!keepPosition) {
    obj.position.set(tx, ty, tz);
  }
  obj.quaternion.set(qx, qy, qz, qw);
  obj.scale.set(sx, sy, sz);
}
