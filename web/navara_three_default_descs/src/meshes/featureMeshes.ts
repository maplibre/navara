import {
  DrapedMesh,
  type PickableMesh,
  type ViewContext,
} from "@navaramap/three";
import { Box3, BufferAttribute, Mesh, Sphere, Vector3 } from "three";
import type {
  BufferGeometry,
  Material,
  Object3D,
  Object3DEventMap,
} from "three";

/**
 * A pickable draped mesh for the standalone polygon.
 *
 * The material enhancer already declares the pick shader, so
 * `PickableMeshWrapper` would redefine it. Picking toggles the enhancer's
 * `pickable` prop instead.
 */
export class FeatureDrapedMesh<M extends Material, E extends Object3DEventMap>
  extends DrapedMesh<BufferGeometry, M, E>
  implements PickableMesh
{
  constructor(
    geometry: BufferGeometry,
    material: M,
    draped: boolean,
    readonly batchId: number,
    private setPickable: (pickable: boolean) => void,
  ) {
    super(geometry, material, draped);
  }

  onBeforePicking() {
    this.setPickable(true);
  }

  onAfterPicking() {
    this.setPickable(false);
  }

  getRenderable(): Object3D {
    return this;
  }
}

/** {@link FeatureDrapedMesh} without the stencil drape, for the polyline. */
export class FeatureMesh<M extends Material, E extends Object3DEventMap>
  extends Mesh<BufferGeometry, M, E>
  implements PickableMesh
{
  constructor(
    geometry: BufferGeometry,
    material: M,
    readonly batchId: number,
    private setPickable: (pickable: boolean) => void,
  ) {
    super(geometry, material);
  }

  onBeforePicking() {
    this.setPickable(true);
  }

  onAfterPicking() {
    this.setPickable(false);
  }

  getRenderable(): Object3D {
    return this;
  }
}

/** Fills `attrBatchId`, which the shaders read unconditionally. */
export function setBatchIdAttribute(
  geometry: BufferGeometry,
  vertexCount: number,
  batchId: number,
) {
  geometry.setAttribute(
    "attrBatchId",
    new BufferAttribute(new Float32Array(vertexCount).fill(batchId), 1),
  );
}

/** Unregisters the material from shadows, then disposes it. */
export function releaseFeatureMaterial(ctx: ViewContext, material: Material) {
  ctx.removeShadowMaterial(material);
  material.dispose();
}

/** Bounding sphere of RTE positions split into high and low parts. */
export function boundingSphereOfRte(
  high: Float32Array,
  low: Float32Array,
): Sphere {
  const box = new Box3();
  const point = new Vector3();
  for (let i = 0; i < high.length; i += 3) {
    point.set(
      high[i] + low[i],
      high[i + 1] + low[i + 1],
      high[i + 2] + low[i + 2],
    );
    box.expandByPoint(point);
  }
  return box.getBoundingSphere(new Sphere());
}
