import { Unimplemented } from "@navaramap/core";
import {
  ModelMaterial as NavaraModelMaterial,
  ModelMesh as NavaraModelMesh,
  Vec3,
} from "@navaramap/engine";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  Points,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  RGBADepthPacking,
  SkinnedMesh,
  Texture,
  type NormalBufferAttributes,
  PointsMaterial,
} from "three";
import invariant from "tiny-invariant";

import {
  attachBatchedMaterial,
  getBatchTextureUniform,
  initBatchedMaterial,
  setBatchTextureRenderer,
  updateBatchAttribute,
  type BatchTextureConfig,
} from "../batchTexture";
import type { EventContext } from "../event/context";
import { applyLitOption } from "../material";
import {
  createModelMaterialEnhancer,
  createPntsEnhancer,
} from "../material/enhancer/model";
import type { ModelMaterialProps, PntsProps } from "../material/enhancer/model";
import type { UniformValue } from "../material/types";
import type { CustomObject3DEventMap } from "../object3DEvent";

import { GEOMETRY_TYPES } from "./constants";
import type { FeatureMesh } from "./featureMesh";
import type { PickableMesh } from "./pickableMesh";
import { releaseGeometryArraysAfterUpload } from "./releaseGeometryArrays";

export type ModelMaterial = MeshStandardMaterial | MeshPhysicalMaterial;

// TODO: Height to adjust the height based on its property.
export type ModelBatchedAttributeName =
  "color" | "show" | "opacity" | "emissive" | "emissiveIntensity";

export const MODEL_BATCH_TEXTURE_CONFIG: BatchTextureConfig = {
  scalars: [],
  vec3s: ["color", "emissive"],
  batchLength: 0,
};

type ModelMaterialEnhancer = ReturnType<typeof createModelMaterialEnhancer>;
type PntsMaterialEnhancer = ReturnType<typeof createPntsEnhancer>;

export class ModelMesh
  extends Object3D<CustomObject3DEventMap>
  implements FeatureMesh, PickableMesh
{
  readonly ctx: EventContext;
  /** Enhanced materials with encapsulated state, one per child mesh */
  private _enhancers = new Map<
    Mesh<BufferGeometry<NormalBufferAttributes>, ModelMaterial>,
    ModelMaterialEnhancer
  >();

  /** Enhanced materials for point cloud objects, one per Points child */
  private _pntsEnhancers = new Map<
    Points<BufferGeometry<NormalBufferAttributes>, PointsMaterial>,
    PntsMaterialEnhancer
  >();

  // model credit for attribution
  credit: string | undefined;
  batchLength?: number;

  constructor(
    ctx: EventContext,
    gltfInfo: {
      scene: Group;
      credit?: string;
    },
    m: NavaraModelMesh,
  ) {
    super();
    this.ctx = ctx;
    this.credit = gltfInfo.credit;
    this.batchLength = m.batch_length;
    this.add(gltfInfo.scene);
    this.init(m);
    this.addEventListener("removedFromWorld", () => {
      this.dispose();
    });
  }

  /**
   * Geometry type of this mesh.
   */
  readonly geometryType = GEOMETRY_TYPES.Model;

  get water(): boolean {
    for (const enhancer of this._enhancers.values()) {
      // Assume the first enhancer has the common value.
      return enhancer.states().water.useWater;
    }
    return false;
  }

  set water(v: boolean) {
    for (const enhancer of this._enhancers.values()) {
      enhancer.update({ water: { water: v } });
    }
  }

  private init(m: NavaraModelMesh) {
    const { buf } = this.ctx;
    const batchIdsData = m.geometry.batch_ids;
    const dataSize = batchIdsData?.size ?? 0;
    // buf.u32 returns a short-lived view into WASM memory; copy to retain it
    // across the traversal below.
    const batchIds = batchIdsData
      ? (buf.u32(batchIdsData.data)?.slice() ?? null)
      : new Uint32Array(dataSize);

    const meshMaterial = m.material;
    const uniforms = this.ctx.uniforms;

    const updateProps = this.buildUpdateProps(meshMaterial);
    const modelInitialProps: ModelMaterialProps = {
      ...updateProps,
      water: {
        ...updateProps.water,
        skyEnvMap: uniforms.tSkyEnvMap.value,
        waterNormalMap: uniforms.waterTexture as UniformValue<Texture | null>,
        timeUniform: uniforms.time as UniformValue<number>,
        skyEnvMapUniform: uniforms.tSkyEnvMap as UniformValue<Texture | null>,
      },
    };

    const geodeticNormal: Vec3 =
      meshMaterial.__internal__?.pointCloudGeodeticNormal ?? new Vec3(0, 0, 0);
    const pntsInitialProps: PntsProps = {
      color: meshMaterial.color ?? 0,
      pointSize: meshMaterial.pointSize ?? 1,
      height: meshMaterial.height ?? 0,
      geodeticNormal,
      divideColor: meshMaterial.__internal__?.pointCloud,
    };

    this.traverse((object: Object3D) => {
      if (object instanceof Mesh) {
        this._setupMeshNode(
          object,
          meshMaterial,
          batchIds,
          dataSize,
          modelInitialProps,
        );
        this._releaseGeometryArrays(object);
      } else if (object instanceof Points) {
        this._setupPointsNode(object, pntsInitialProps);
        this._releaseGeometryArrays(object);
      }
    });

    this.visible = meshMaterial.show ?? true;
  }

  /**
   * Drop the CPU-side typed arrays of a loaded glTF/point-cloud node after its
   * first GPU upload. The GLTFLoader has already computed bounding volumes at
   * parse time (and the point-cloud path assigns them from the WASM AABB), and
   * `_setupMeshNode` has already read `_batchid.array` before this runs, so no
   * CPU read survives the first upload.
   *
   * Skipped for skinned meshes and geometries with morph targets: those keep
   * their CPU arrays for per-frame skinning/morphing on the CPU.
   */
  private _releaseGeometryArrays(node: Mesh | Points) {
    if (node instanceof SkinnedMesh) return;
    const geometry = node.geometry;
    if (!(geometry instanceof BufferGeometry)) return;
    if (
      geometry.morphAttributes &&
      Object.keys(geometry.morphAttributes).length
    )
      return;
    releaseGeometryArraysAfterUpload(geometry);
  }

  _initBatchedMaterial(
    mesh: Mesh<BufferGeometry<NormalBufferAttributes>, ModelMaterial>,
  ) {
    initBatchedMaterial(mesh.material, MODEL_BATCH_TEXTURE_CONFIG);
  }

  _initBatchDataTexture(
    mesh: Mesh<BufferGeometry<NormalBufferAttributes>, ModelMaterial>,
  ): void {
    invariant(this.batchLength != null);

    const config: BatchTextureConfig = {
      ...MODEL_BATCH_TEXTURE_CONFIG,
      batchLength: this.batchLength,
    };

    initBatchedMaterial(mesh.material, config);
    // Claim the texture for this view's renderer before any write can
    // create it (flushing is per-view over module-global queues).
    setBatchTextureRenderer(mesh.material, this.ctx.viewContext.getRenderer());

    // Hand the shared uniform ref to the enhancer: texture creation/growth
    // swaps its `.value`, so no re-wiring is needed afterwards.
    const uniform = getBatchTextureUniform(mesh.material);
    const enhancer = this._enhancers.get(mesh);
    if (uniform && enhancer) {
      enhancer.update({ base: { batchDataTexture: uniform } });
    }
  }

  _updateBatchAttribute(
    mesh: Mesh<BufferGeometry<NormalBufferAttributes>, ModelMaterial>,
    batchId: number,
    attribute: ModelBatchedAttributeName,
    value: number | number[] | boolean,
  ): void {
    // Write the texture first: it validates the value and captures the
    // backfill defaults before the enhancer resets material.color to white,
    // and a rejected write must not stamp any define — the shaders have no
    // safety net for an unwritten receiver.
    const wrote = updateBatchAttribute(
      mesh.material,
      batchId,
      attribute,
      value,
      {
        color: mesh.material.color,
        emissive: mesh.material.emissive,
        emissiveIntensity: mesh.material.emissiveIntensity,
      },
    );
    if (!wrote) return;

    const enhancer = this._enhancers.get(mesh);
    if (enhancer && attribute === "color") {
      // When batch color is first used, set material.color to white
      // (multiplier identity: white * batch color = batch color).
      if (!enhancer.states().base.batchColorEnabled) {
        enhancer.update({
          base: { batchColorEnabled: true, color: 0xffffff },
        });
      }
    }
  }

  private _setupMeshNode(
    mesh: Mesh<BufferGeometry<NormalBufferAttributes>, ModelMaterial>,
    meshMaterial: NavaraModelMaterial,
    batchIds: Uint32Array<ArrayBufferLike> | null,
    dataSize: number,
    initialProps: ModelMaterialProps,
  ) {
    if (!batchIds) return;

    const vertCnt = mesh.geometry.attributes?.position?.count;

    const attrBatchIds = new Float32Array(vertCnt);
    // B3DM (1.0) uses _batchid; glTF with EXT_mesh_features (1.1) uses _FEATURE_ID_N.
    // Assign _FEATURE_ID_0 to _batchid so the batch texture shader works unchanged.
    // Also accept lowercase _feature_id_0 as a compatibility fallback.
    const attrs = mesh.geometry.attributes;
    const featureIdAttribute =
      attrs?.["_FEATURE_ID_0"] ?? attrs?.["_feature_id_0"];
    if (!attrs?._batchid && featureIdAttribute) {
      // TODO: Support other feature ID semantics such as `_FEATURE_ID_n`.
      // Need to clone, since it might be switch to different feature ID attributes.
      mesh.geometry.setAttribute("_batchid", featureIdAttribute.clone());
    }
    const internalBatchIds = attrs?._batchid?.array;

    if (internalBatchIds) {
      let i = 0;
      for (const internalBatchId of internalBatchIds) {
        attrBatchIds[i] = batchIds[internalBatchId] ?? 0;
        i++;
      }
    } else {
      for (let i = 0; i < vertCnt; i++) {
        attrBatchIds[i] = batchIds[0];
      }
    }

    mesh.geometry.setAttribute(
      "batchId",
      new BufferAttribute(attrBatchIds, dataSize),
    );

    mesh.castShadow = !!meshMaterial.castShadow;
    mesh.receiveShadow = !!meshMaterial.receiveShadow;
    applyLitOption(mesh.material, meshMaterial.lit);

    mesh.material.depthTest = true;
    mesh.material.depthWrite = true;

    const enhancer = createModelMaterialEnhancer(mesh.material);
    this._enhancers.set(mesh, enhancer);

    enhancer.mount(initialProps);

    mesh.material.customProgramCacheKey = () => enhancer.programCacheKey();
    mesh.material.onBeforeCompile = enhancer.transformShader;

    this._initBatchedMaterial(mesh);

    this.initDepthMaterial(mesh, enhancer);

    this.ctx.viewContext.applyShadowMaterial(mesh.material);
  }

  private _setupPointsNode(
    points: Points<BufferGeometry<NormalBufferAttributes>, PointsMaterial>,
    initialProps: PntsProps,
  ) {
    const enhancer = createPntsEnhancer(points.material);
    this._pntsEnhancers.set(points, enhancer);

    enhancer.mount(initialProps);

    points.material.customProgramCacheKey = () => enhancer.programCacheKey();
    points.material.onBeforeCompile = enhancer.transformShader;
  }

  /**
   * Override a material that is used to generate a shadow map.
   */
  initDepthMaterial(
    mesh: Mesh<BufferGeometry<NormalBufferAttributes>, ModelMaterial>,
    enhancer: ModelMaterialEnhancer,
  ) {
    mesh.customDepthMaterial = mesh.material.clone();
    mesh.customDepthMaterial.needsUpdate = true;

    const origin = mesh.material;
    // Attach to the batch texture state so layout allocations bump this
    // clone's needsUpdate too — its compiled defines come from the origin, so
    // it must recompile whenever they change.
    attachBatchedMaterial(origin, mesh.customDepthMaterial);
    // The clone's compiled defines come from the origin, so key its program on
    // the origin's key (which includes the per-instance batch layout defines);
    // the prefix separates it from the origin's own program.
    mesh.customDepthMaterial.customProgramCacheKey = () =>
      `nvr-depth:${origin.customProgramCacheKey()}`;

    mesh.customDepthMaterial.onBeforeCompile = (shader) => {
      enhancer.transformShader(shader);

      shader.defines ??= {};
      Object.assign(shader.defines, mesh.material.userData?.defines || {});
      shader.defines["USE_SHADOWMAP_DEPTH"] = 1;
      shader.defines["DEPTH_PACKING"] = RGBADepthPacking;
    };
  }

  _update(material: NavaraModelMaterial, active: boolean) {
    this.visible = (material.show ?? true) && active;

    // Each enhancer map is populated only for its node type, so empty maps
    // iterate trivially. Running both lets mixed-mode glTFs (POINTS + TRIANGLES)
    // update each node with the right props without a tile-level flag.
    const updateProps = this.buildUpdateProps(material);
    for (const [mesh, enhancer] of this._enhancers) {
      // Once per-feature batch colors own the material, `material.color` must
      // not re-tint the white multiplier identity (mirrors polygon/polyline's
      // `batchColorEnabled ? undefined : material.color` guard).
      enhancer.update(
        enhancer.states().base.batchColorEnabled
          ? { ...updateProps, base: { ...updateProps.base, color: undefined } }
          : updateProps,
      );
      mesh.castShadow = !!material.castShadow;
      mesh.receiveShadow = !!material.receiveShadow;
      applyLitOption(mesh.material, material.lit);
    }

    const pntsProps: PntsProps = {
      color: material.color,
      pointSize: material.pointSize,
      height: material.height,
    };
    for (const enhancer of this._pntsEnhancers.values()) {
      enhancer.update(pntsProps);
    }
  }

  /**
   * Build update props from NavaraModelMaterial for enhancer.update().
   */
  private buildUpdateProps(material: NavaraModelMaterial): ModelMaterialProps {
    return {
      base: {
        color: material.color,
        metalness: material.metalness,
        roughness: material.roughness,
        emissiveColor: material.emissiveColor,
        emissiveIntensity: material.emissiveIntensity,
        transparent: material.transparent,
        opacity: material.opacity,
        depthWrite: material.depthWrite,
        effectIdsMask:
          this.ctx.viewContext.selectiveEffectRegistry?.computeMask(
            material.effectIds ?? [],
          ) ?? 0,
      },
      water: {
        water: material.water,
        waterScaleNormal: material.waterScaleNormal,
        waterSpeed: material.waterSpeed,
        shininess: material.shininess,
        specularStrength: material.specularStrength,
        applyWaterNormal: material.applyWaterNormal,
        specular: material.specular,
        ior: material.ior,
        reflectivity: material.reflectivity,
      },
    };
  }

  traverseMesh(
    callback: (
      m: Mesh<BufferGeometry<NormalBufferAttributes>, ModelMaterial>,
    ) => void,
  ) {
    this.traverse((object: Object3D) => {
      if (!(object instanceof Mesh)) {
        return;
      }
      callback(object);
    });
  }

  _setFeatureColor(color: Color, m?: ModelMaterial) {
    m?.color.set(color);
  }

  _getFeatureColor(): Color {
    throw new Unimplemented();
  }

  _setFeatureShow(visible: boolean): void {
    this.visible = visible;
  }

  _setFrustumCulled(culled: boolean): void {
    this.frustumCulled = culled;
  }

  onBeforePicking(): void {
    this.setPickable(true);
  }

  onAfterPicking(): void {
    this.setPickable(false);
  }

  private setPickable(pickable: boolean): void {
    for (const enhancer of this._enhancers.values()) {
      enhancer.update({ base: { pickable } });
    }
  }

  getRenderable(): Object3D {
    return this;
  }

  _setFeatureHeight(_height: number) {
    // Height adjustment via batch textures is currently not implemented.
  }

  _setFeatureOpacity(opacity: number): void {
    // Only reached on the non-batched evaluator path (no _batchid attribute),
    // where updateBatchAttribute would reject the write (batchLength 0) —
    // apply directly to the materials instead, like _setFeatureColor/Show.
    this.traverseMesh((m) => {
      this._enhancers.get(m)?.update({ base: { opacity } });
    });
  }

  dispose() {
    this.traverseMesh((m) => {
      this.ctx.viewContext.removeShadowMaterial(m.material);
    });
  }
}
