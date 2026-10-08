import type { TileHandle } from "@navaramap/core";
import { generate_id_from_entity } from "@navaramap/core";
import {
  type RenderableFeatureAddedEvent,
  type RenderableFeature,
  RenderableFeatureChangedEvent,
} from "@navaramap/engine";
import { Mesh, Sprite, Object3D, Scene } from "three";

import {
  BatchedSdfTextMesh,
  InstancedSpriteMesh,
  ModelMesh,
  PolygonMesh,
  PolylineMesh,
} from "../mesh";
import { FEATURE_RENDER_ORDER, STROKE_RENDER_ORDER } from "../renderOrder";
import type { Scenes } from "../scene";

import type { EventContext } from "./context";
import {
  handleFeatureCreatedEventByLayerId,
  handleFeatureUpdatedEventByLayerId,
  handleFeatureVisibilityChangedEventByLayerId,
} from "./featureEvent";
import { renderBillboard, processBillboardChanged } from "./features/billboard";
import { renderModel, processModelChanged } from "./features/model";
import { sumModelGpuBytes } from "./features/modelGpuBytes";
import { renderPoint, processPointChanged } from "./features/point";
import { renderPolygon, processPolygonChanged } from "./features/polygon";
import {
  renderPolygonOutline,
  processPolygonOutlineChanged,
} from "./features/polygonOutline";
import { renderPolyline, processPolylineChanged } from "./features/polyline";
import { renderText, processTextChanged } from "./features/text";

import { setTransform } from ".";

/**
 * Upper bound on how long a text batch's render-completion report waits for
 * label shaping (see processRenderableFeatureAdded). Settling normally takes
 * tens of milliseconds; the cap exists so a hung font fetch cannot stall the
 * tile LOD indefinitely.
 */
const TEXT_LABELS_SETTLE_TIMEOUT_MS = 2000;

/**
 * Choose the render scene for a non-draped feature based on its material.
 *
 * Sprites (billboards/points) and SDF text configured with `depthTest: false`
 * are meant to render always-on-top. Left in the MRT scene they draw before the
 * depth-based post-processing effects (aerial perspective, clouds, ssao,
 * atmosphere), which sample the depth buffer — where these features wrote
 * nothing — and composite over them, painting them out. Route them into the
 * transparent scene, which TransparentPassEffectDesc renders (clear=false)
 * after those effects. Every other non-draped feature stays in the MRT scene.
 *
 * The material comes straight from the engine event (the source of truth): text
 * applies its Three material asynchronously (behind font preparation), so the
 * live mesh material can lag behind the intended `depthTest`.
 */
function overlayScene(
  material: { depthTest?: boolean } | undefined,
  scenes: Scenes,
): Scene {
  return material?.depthTest === false ? scenes.transparent : scenes.mrt;
}

export function renderFeature(
  ctx: EventContext,
  f: RenderableFeature,
  tileHandle: TileHandle | undefined,
  layerId: string,
): Promise<Mesh | Sprite | Object3D | undefined> | undefined {
  if (f.point) {
    return renderPoint(ctx, f.point);
  }
  if (f.billboard) {
    return renderBillboard(ctx, f.billboard);
  }
  if (f.model) {
    return renderModel(ctx, f.model);
  }
  if (f.polyline) {
    return renderPolyline(ctx, f.polyline);
  }
  if (f.polygon) {
    return renderPolygon(ctx, f.polygon, tileHandle, layerId);
  }
  if (f.text) {
    return renderText(ctx, f.text, layerId);
  }
}

export const isModelFeature = (feature: RenderableFeature): boolean =>
  !!feature.model;

export async function processRenderableFeatureAdded(
  ctx: EventContext,
  ev: RenderableFeatureAddedEvent,
) {
  const {
    scenes,
    meshes,
    texturizedSceneByTileCoordinates,
    featureHandler,
    viewEvents,
    layersManager,
    updatedAt,
    layerHandler,
  } = ctx;
  const id = generate_id_from_entity(ev);
  const feature = ev.feature;

  const { point, billboard, text, polyline, polygon, model } = feature;

  const overscaledTileHandle = ev.overscaled_tile_handle;

  const tileHandle = overscaledTileHandle?.handle;

  const featureLayerId = ev.layer_id;

  // Captured once: the render-completion report is deferred until the mesh is
  // in its render/bake scene (see below), by which point `ev` may be gone.
  const bits = ev.bits;
  const renderedType =
    point || billboard || text
      ? "point"
      : model
        ? "model"
        : polyline
          ? "polyline"
          : polygon
            ? "polygon"
            : undefined;

  const obj = await renderFeature(
    ctx,
    feature,
    tileHandle,
    featureLayerId,
  )?.then((r) => {
    // The glTF/Draco decode happened on the JS side, so report the actual
    // decoded GPU size back to the ledger (its compressed-payload estimate
    // undercounts Draco content). Draco decode inflates geometry markedly.
    if (model && r) {
      featureHandler.reportFeatureGpuBytes(ev.bits, sumModelGpuBytes(r));
    }
    // The billboard image atlas (CPU pixel buffer + GPU texture) is
    // allocated and grown lazily on the JS side as images load, so the
    // mesh reports its measured footprint whenever it changes; the ledger
    // folds it into the owning vector tile's cost. Capture `bits` as a
    // plain number now: the reporter fires long after this WASM event
    // object is freed (async image packs), and a deferred `ev.bits` read
    // would throw "null pointer passed to rust".
    if (billboard && r instanceof InstancedSpriteMesh) {
      const featureBits = ev.bits;
      r.setAtlasBytesReporter((bytes) =>
        featureHandler.reportFeatureGpuBytes(featureBits, bytes),
      );
    }
    return r;
  });

  if (!obj) {
    // renderFeature produced no mesh (e.g. empty geometry); still report
    // rendered so the tile's LOD/activation can advance, as before.
    if (renderedType) featureHandler.markFeatureIsRendered(renderedType, bits);
    return;
  }

  // Sprite should be handled by mesh itself.
  const transform = (polyline ?? polygon ?? model)?.transform;
  if (transform) {
    setTransform(obj, transform);
  }

  // Strokes draw after fills: sibling meshes are created asynchronously in
  // arbitrary order, and a fill drawn after a coplanar stroke either paints
  // over it (bake scene) or z-fights against its depth (MRT scene), so the
  // stacking must come from renderOrder, not insertion order. Only polylines
  // stroking polygon rings sit on a sibling fill; standalone line strokes
  // keep the base order — elevated, they would deterministically composite
  // over every marker and outline they merely cross (PolylineMesh skips the
  // depth test in the MRT scene).
  const strokesSiblingFills =
    polyline?.material.geometryTypes?.includes("polygon") ?? false;
  obj.renderOrder =
    obj instanceof PolylineMesh && strokesSiblingFills
      ? STROKE_RENDER_ORDER
      : FEATURE_RENDER_ORDER;

  // Add to MRT scene if not draped (draped features render to texturized scene)
  const isDraped =
    (obj instanceof PolygonMesh && obj.clampToGround) ||
    (obj instanceof PolylineMesh && obj.draped);
  if (!isDraped) {
    const material = point?.material ?? billboard?.material ?? text?.material;
    overlayScene(material, scenes).add(obj);
  }

  meshes.set(id, obj);

  // `!= null` (not truthiness): the root vector tile's handle is 0, which is
  // falsy — a truthy check silently dropped root-tile draped meshes from the
  // texturized scene cache, leaving small datasets that render at z0 blank.
  if (isDraped && tileHandle != null) {
    // Insert the bakeable draped mesh into the per-tile cache now (it is fully built at
    // this point). Readiness/ancestor-fallback is decided entirely on the Rust side from
    // the ECS lifecycle, so no `scene_ready` is reported. Insert even when invisible —
    // the offscreen bake skips invisible meshes.
    const layerIndex = layerHandler?.getLayerIndex(featureLayerId);
    // Timing: the layer may have been removed before this event; skip the insert then (the
    // mesh object still exists, it just won't be baked for this layer).
    if (layerIndex != null) {
      texturizedSceneByTileCoordinates.add(
        tileHandle,
        featureLayerId,
        obj as Mesh,
        layerIndex,
      );
    }
    obj.addEventListener("removedFromWorld", () => {
      texturizedSceneByTileCoordinates.removeMesh(
        tileHandle,
        featureLayerId,
        obj as Mesh,
      );
    });
    obj.addEventListener("needsUpdate", () => {
      texturizedSceneByTileCoordinates.markDirty(tileHandle, featureLayerId);
    });
  }

  // Report render-completion to Rust only now that the mesh is in its render
  // (MRT) or bake (texturized) scene. For draped features this must follow the
  // `texturizedSceneByTileCoordinates.add` above: the Rust drape resolve flips a
  // terrain tile's vector source to this tile once its features report rendered,
  // so reporting before the offscreen scene existed left the terrain tile's
  // vector drape blank until a camera-move re-traverse.
  //
  // Text batches are the exception: the report drives the Rust tile-LOD swap,
  // and a text batch draws nothing until its labels finish async font shaping,
  // which the evaluator only kicks off further down. Reporting here swapped
  // the parent tile out for a child that couldn't draw yet — a tile-shaped
  // blank on every LOD refinement. Their report is deferred below.
  const isTextBatch = obj instanceof BatchedSdfTextMesh;
  if (renderedType && !isTextBatch) {
    featureHandler.markFeatureIsRendered(renderedType, bits);
  }

  if (obj instanceof PolygonMesh && polygon && polygon.outline_geometry) {
    const outline = await renderPolygonOutline(ctx, polygon);
    outline.renderOrder = FEATURE_RENDER_ORDER;
    scenes.mrt.add(outline);

    obj.outline = outline;

    obj.addEventListener("removedFromWorld", () => {
      obj.outline?.clear();
      obj.outline?.removeFromParent();
    });
  }

  handleFeatureCreatedEventByLayerId(
    featureHandler,
    obj,
    viewEvents,
    layersManager,
    featureLayerId,
    ev.bits,
  );
  // Text batches also get their initial `featureUpdated` while still
  // invisible: tiles spawn inactive, and apps that style text through
  // `featureUpdated` must be able to populate label texts *before* the
  // tile-LOD swap flips this batch visible (per-label writes persist in the
  // label data texture, so styling hidden batches is safe). Otherwise labels
  // could not exist until after the swap, guaranteeing a blank activation.
  if (obj.visible || isTextBatch) {
    handleFeatureUpdatedEventByLayerId(
      viewEvents,
      layersManager,
      featureLayerId,
      ev.bits,
      updatedAt,
    );
  }

  // The evaluator runs synchronously inside the emits above, so any font
  // preparation it *started* is in flight now. Report the text batch rendered
  // only once those land, so the Rust swap waits until this batch can draw.
  // The timeout only bounds a hung font fetch — a late or post-removal report
  // is a safe no-op on the Rust side.
  //
  // With declutter on, the evaluator's setters park unprepared text on anchor
  // visibility instead of preparing it (BatchedSdfTextMesh.setTextByBatchIndex),
  // so nothing is in flight here and this resolves immediately. That is
  // deliberate and must stay that way: promotion needs the batch visible,
  // visibility needs this report, so waiting on parked labels would deadlock
  // the cycle until the timeout and stall every text tile's swap. Continuity
  // across decluttered swaps comes from the placement handoff in `setActive`.
  if (renderedType && obj instanceof BatchedSdfTextMesh) {
    void obj.whenLabelsSettled(TEXT_LABELS_SETTLE_TIMEOUT_MS).then(() => {
      featureHandler.markFeatureIsRendered(renderedType, bits);
      ctx.renderFlag.forceUpdate = true;
    });
  }
}

export async function processRenderableFeatureChanged(
  ctx: EventContext,
  ev: RenderableFeatureChangedEvent,
) {
  const {
    scenes,
    meshes,
    texturizedSceneByTileCoordinates,
    viewEvents,
    layersManager,
    updatedAt,
  } = ctx;
  const id = generate_id_from_entity(ev);
  const obj = meshes.get(id);
  if (!obj) return;

  const layerId = ev.layer_id;

  const overscaledTileHandle = ev.overscaled_tile_handle;
  const tileHandle = overscaledTileHandle?.handle;

  const { point, billboard, text, polyline, polygon, model } = ev.feature;

  const active =
    (point ?? billboard ?? text ?? polyline ?? polygon ?? model)?.active ??
    true;

  // Capture visibility before material updates to detect changes
  const prevVisible = obj.visible;

  if (obj instanceof InstancedSpriteMesh && point) {
    processPointChanged(obj, point, active);
  }
  if (obj instanceof InstancedSpriteMesh && billboard) {
    await processBillboardChanged(obj, billboard, active);
  }

  if (obj instanceof BatchedSdfTextMesh && text) {
    await processTextChanged(obj, text, active);
  }

  // `depthTest` may have flipped at runtime, changing which scene a sprite or
  // text feature belongs to (transparent for always-on-top overlays, MRT
  // otherwise). Re-route based on the incoming material; Three's `add()`
  // reparents safely, and the guard keeps draped/model/polygon/polyline
  // features untouched.
  if (obj instanceof InstancedSpriteMesh || obj instanceof BatchedSdfTextMesh) {
    const material = point?.material ?? billboard?.material ?? text?.material;
    const target = overlayScene(material, scenes);
    if (obj.parent !== target) {
      target.add(obj);
      ctx.renderFlag.forceUpdate = true;
    }
  }
  if (obj instanceof ModelMesh && model) {
    processModelChanged(obj, model, active);
  }
  if (obj instanceof PolylineMesh && polyline) {
    processPolylineChanged(obj, polyline, active);
  }
  if (obj instanceof PolygonMesh && polygon) {
    processPolygonChanged(obj, polygon, active, tileHandle);

    if (obj.outline) {
      processPolygonOutlineChanged(obj.outline, polygon, active);
    }
  }

  // A draped feature's material/visibility changed: bump the layer scene's revision so the
  // consuming TileMesh re-bakes (invisible meshes stay in the scene and are skipped at bake).
  // Cache membership is owned by CREATE / `removedFromWorld`; a runtime `clampToGround` flip
  // is not handled here (rare — the flag is set once at mesh init).
  if (
    ((obj instanceof PolygonMesh && obj.clampToGround) ||
      (obj instanceof PolylineMesh && obj.draped)) &&
    tileHandle != null // the root tile's handle is 0 (falsy)
  ) {
    texturizedSceneByTileCoordinates.markDirty(tileHandle, layerId);
  }

  // Emit visibility changed event if visibility actually changed after material updates
  if (prevVisible !== obj.visible) {
    handleFeatureVisibilityChangedEventByLayerId(
      layersManager,
      layerId,
      ev.bits,
      obj.visible,
    );
  }

  // Point, billboard and text should be handled by their mesh.
  const transform = (polyline ?? polygon ?? model)?.transform;

  // This should be handled after the asynchronous process to avoid a conflict.
  if (transform) {
    setTransform(obj, transform);
  }

  obj.updateMatrix();

  // Re-emit `featureUpdated` (which re-runs the layer's registered evaluator
  // over this whole feature set) only when the set is actually displayed at the
  // current LOD. `obj.visible` is not that signal for draped meshes: they stay
  // visible while built so they remain stable bakeable drape sources (see
  // PolygonMesh._update), so gating on it alone re-evaluated every built draped
  // tile on every activation flip during zoom. The evaluator's per-feature
  // values persist in the batch data texture, and user-driven restyles reach
  // inactive sets through `Layer.forceUpdate`, so skipping inactive sets here
  // is safe.
  if (obj.visible && active) {
    handleFeatureUpdatedEventByLayerId(
      viewEvents,
      layersManager,
      layerId,
      ev.bits,
      updatedAt,
    );
  }
}
