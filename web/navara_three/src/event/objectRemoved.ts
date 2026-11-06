import { generate_id_from_entity } from "@navaramap/core";
import type { EntityEvent } from "@navaramap/engine";
import { Mesh, Object3D, Sprite } from "three";

import { BatchedSdfTextMesh } from "../mesh";

import type { EventContext } from "./context";

/**
 * Dispose a job's product and drop it from the `meshes` index. `obj` is
 * `undefined` for a job that never produced one, including a `start` that
 * threw after indexing its object; the indexed object is disposed then. `ev`
 * is `undefined` when the dispatcher is disposed while the job was in flight.
 */
export function processObjectRemoved(
  ctx: EventContext,
  product: Object3D | undefined,
  ev?: EntityEvent,
) {
  let obj = product;
  if (ev) {
    const id = generate_id_from_entity(ev);
    const indexed = ctx.meshes.get(id);
    obj ??= indexed;
    if (indexed === obj) ctx.meshes.delete(id);
  }
  if (!obj) return;

  disposeObject3D(obj);

  if (obj instanceof BatchedSdfTextMesh) {
    obj.dispose();
  }

  // Custom event not in Object3DEventMap
  // @ts-expect-error - removedFromWorld is a custom event
  obj.dispatchEvent({ type: "removedFromWorld" });

  // clear should after dispose, otherwise model's children will not be disposed
  obj.clear();

  // Detach from whatever scene it was added to (mrt for opaque features,
  // transparent for always-on-top overlay sprites, globe for globe meshes).
  obj.removeFromParent();
}

/**
 * Dispose every live product, as its removal would, and empty the `meshes`
 * index. Covers tile meshes outside the index too (one whose geometry was
 * never installed still holds its drape targets and atlas reference). Run
 * after the dispatcher is disposed and before the managers their removal
 * releases into (compositor, font manager, declutter).
 */
export function disposeAllObjects(ctx: EventContext): void {
  for (const obj of ctx.meshes.values()) {
    processObjectRemoved(ctx, obj);
  }
  ctx.meshes.clear();
  // A disposed tile drops itself from the map.
  for (const tile of ctx.tileMapByHandle.values()) {
    processObjectRemoved(ctx, tile);
  }
}

function disposeObject3D(model: Object3D): void {
  model.traverse((object: Object3D) => {
    if (object instanceof Mesh) {
      const mesh = object as Mesh;

      // Dispose geometry and aggressively drop all attributes
      const g = mesh.geometry;
      if (g) {
        g.dispose?.();

        // Remove every BufferAttribute (handles polyline/polygon custom attrs)
        if (g.attributes) {
          for (const key of Object.keys(g.attributes)) {
            g.deleteAttribute(key);
          }
        }

        g.index = null;
        g.boundingBox = null;
        g.boundingSphere = null;
      }

      // Dispose material(s)
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => {
            material.dispose();
          });
        } else {
          const material = mesh.material;
          material.dispose();
        }
      }
    }
    // point, billboard, text
    else if (object instanceof Sprite) {
      const sprite = object as Sprite;

      // Dispose material
      if (sprite.material) {
        if (Array.isArray(sprite.material)) {
          sprite.material.forEach((material) => {
            material.dispose();
          });
        } else {
          const material = sprite.material;
          material.dispose();
        }
      }
    }
  });
}
