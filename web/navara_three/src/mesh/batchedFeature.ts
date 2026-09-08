import { Unimplemented } from "@navaramap/core";
import {
  BufferAttribute,
  BufferGeometry,
  Material,
  Mesh,
  Object3D,
  type Vector2,
  type NormalBufferAttributes,
} from "three";
import invariant from "tiny-invariant";

import {
  BATCHED_ATTRIBUTE_NAMES,
  initBatchedMaterial,
  updateBatchAttribute,
  type BatchedAttributeName,
  type BatchScalarKey,
  type BatchTextureConfig,
  type BatchVec3Key,
  type DefaultBatchAttributeValues,
} from "../batchTexture";
import type { CustomObject3DEventMap } from "../object3DEvent";

import { PickableMesh } from "./pickableMesh";

export type BatchedFeatureAttributes<
  Attr extends NormalBufferAttributes = NormalBufferAttributes,
> = {
  _batchid?: BufferAttribute;
} & Attr;

/**
 * SCALARS-row component assignment per mesh type. A mesh's scalars must only
 * contain attributes its shaders declare receiver variables for:
 * `updateBatchAttribute` turns a `USE_BATCH_*` define on whenever the slot
 * exists, and the shared `batch_texture_vertex` chunk then assigns to the
 * receiver — an undeclared one (e.g. `addExtrudedHeight` in the polyline
 * shaders) breaks shader compilation.
 */
export const POLYGON_BATCH_SCALARS: BatchScalarKey[] = [
  "height",
  "extrudedHeight",
];

export const POLYLINE_BATCH_SCALARS: BatchScalarKey[] = ["height", "lineWidth"];

export class BatchedFeatureMesh<
  Buf extends BufferGeometry<BatchedFeatureAttributes> =
    BufferGeometry<BatchedFeatureAttributes>,
  M extends Material = Material,
  E extends CustomObject3DEventMap = CustomObject3DEventMap,
>
  extends Mesh<Buf, M, E>
  implements PickableMesh
{
  batchLength?: number;
  static _isBatchedAttributeName(v: string): v is BatchedAttributeName {
    return BATCHED_ATTRIBUTE_NAMES.includes(v as BatchedAttributeName);
  }

  _setBatchIndex(
    batchIndex: Float32Array | null | undefined,
    size: number | null | undefined,
  ) {
    if (!batchIndex || !size) return;

    // Align to B3DM attribute: https://github.com/CesiumGS/3d-tiles/blob/492adb06b00870d9ee99b8d97c261a466783034c/specification/TileFormats/Batched3DModel/README.adoc#binary-gltf
    // TODO: However this need to be migrated to v1.1 in the future
    this.geometry.setAttribute(
      "_batchid",
      new BufferAttribute(batchIndex, size),
    );
  }

  /**
   * SCALARS-row assignment supported by this mesh type's shaders. Attributes
   * without a slot are silently ignored by `updateBatchAttribute`.
   */
  _getBatchTextureScalars(): BatchScalarKey[] {
    throw new Unimplemented();
  }

  /**
   * vec3 attributes supported by this mesh type's shaders (same receiver
   * rule as scalars). Color is universal; override to add e.g. emissive.
   */
  _getBatchTextureVec3s(): BatchVec3Key[] {
    return ["color"];
  }

  _initBatchedMaterial() {
    initBatchedMaterial(this.material, {
      scalars: this._getBatchTextureScalars(),
      vec3s: this._getBatchTextureVec3s(),
      batchLength: 0,
    });
  }

  _initBatchDataTexture(): void {
    invariant(this.batchLength != null);

    const config: BatchTextureConfig = {
      scalars: this._getBatchTextureScalars(),
      vec3s: this._getBatchTextureVec3s(),
      batchLength: this.batchLength,
    };

    initBatchedMaterial(this.material, config);
  }

  /** Returns whether the write landed (see {@link updateBatchAttribute}). */
  _updateBatchAttribute(
    batchId: number,
    attribute: BatchedAttributeName,
    value: number | number[] | boolean,
  ): boolean {
    const wrote = updateBatchAttribute(
      this.material,
      batchId,
      attribute,
      value,
      this._getDefaultBatchAttributeValues(),
    );

    if (wrote) this.needsUpdate();
    return wrote;
  }

  needsUpdate() {
    this.dispatchEvent({ type: "needsUpdate" } as any); // Events aren't inferred well.
  }

  _getDefaultBatchAttributeValues(): DefaultBatchAttributeValues {
    throw new Unimplemented();
  }

  onBeforePicking(_pickingCoord?: Vector2) {
    this.material.userData.uPickable.value = 1.0;
    this.needsUpdate();
  }

  onAfterPicking() {
    this.material.userData.uPickable.value = 0.0;
    this.needsUpdate();
  }

  getRenderable(): Object3D {
    return this;
  }

  clone() {
    return new BatchedFeatureMesh(this.geometry, this.material) as this;
  }
}
