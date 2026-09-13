import type { TileHandle } from "@navaramap/core";
import {
  PolygonMesh as NavaraPolygonMesh,
  PolygonMaterial,
} from "@navaramap/engine";
import {
  BufferAttribute,
  BufferGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RGBADepthPacking,
  Sphere,
  SphereGeometry,
  Mesh as ThreeMesh,
  Vector3,
} from "three";
import invariant from "tiny-invariant";

import { PolygonOutlineMesh } from "..";
import {
  attachBatchedMaterial,
  registerBatchedMaterial,
  type BatchedAttributeName,
  POLYGON_BATCH_SUPPORT,
  type BatchTextureSupport,
} from "../batchTexture";
import type { EventContext } from "../event/context";
import { applyLitOption } from "../material";
import type { PolygonMaterialProps } from "../material/enhancer/polygon";
import { createPolygonMaterialEnhancer } from "../material/enhancer/polygon/polygonMaterialEnhancer";

import {
  BatchedFeatureMesh,
  type BatchedFeatureAttributes,
} from "./batchedFeature";
import { GEOMETRY_TYPES } from "./constants";
import { releaseGeometryArraysAfterUpload } from "./releaseGeometryArrays";
import { setupRTECallback } from "./rtcRteHelper";

/** Set to true to render bounding spheres as wireframe spheres for debugging. */
const DEBUG_BOUNDING_SPHERE = false;

type Attributes = BatchedFeatureAttributes<{
  position?: BufferAttribute; // Present when use_rte = false
  position_3d_high?: BufferAttribute; // Present when use_rte = true
  position_3d_low?: BufferAttribute; // Present when use_rte = true
  normal: BufferAttribute;
  scaleNormalAndCap: BufferAttribute;
  attrBatchId: BufferAttribute;
}>;

export class PolygonMesh extends BatchedFeatureMesh<
  BufferGeometry<Attributes>,
  MeshLambertMaterial
> {
  outline?: PolygonOutlineMesh;

  private _baseBoundingSphere?: {
    surfaceCenter: Vector3; // Center point on ellipsoid surface (without height)
    aabbRadius: number; // Horizontal extent radius from AABB
  };

  /** Debug wireframe mesh visualizing the bounding sphere */
  private _debugBoundingSphereMesh?: ThreeMesh;

  /** Running min/max of per-feature batch height values */
  private _minBatchHeight = 0;
  private _maxBatchHeight = 0;
  /** Running max of per-feature batch extruded height values */
  private _maxBatchExtrudedHeight = 0;

  readonly ctx: EventContext;
  /** Layer ID for SelectiveEffect handling */
  private _layerId: string;

  /** Enhanced material with encapsulated state */
  private _enhancedMaterial?: ReturnType<typeof createPolygonMaterialEnhancer>;

  constructor(ctx: EventContext, layerId: string) {
    super(new BufferGeometry<Attributes>(), new MeshLambertMaterial());

    this.ctx = ctx;
    this._layerId = layerId;
  }

  ready() {
    return !!this._enhancedMaterial;
  }

  /**
   * Geometry type of this mesh.
   */
  readonly geometryType = GEOMETRY_TYPES.Polygon;

  init(mesh: NavaraPolygonMesh, tileHandle: TileHandle | undefined) {
    this.batchLength = mesh.batch_length;
    // Register cleanup listener first (before any potential early returns)
    // This ensures dispose() is called even if geometry initialization fails
    this.addEventListener("removedFromWorld", () => {
      this.dispose();
    });

    const { success, useRTE } = this.initGeometry(mesh);
    if (!success) {
      console.warn("PolygonMesh.init: geometry initialization failed");
      return this;
    }
    this.initMaterial(mesh, tileHandle, useRTE);
    this.initDepthMaterial();

    if (mesh.bounding_sphere) {
      const bs = mesh.bounding_sphere;

      this._baseBoundingSphere = {
        // If this mesh is tile based, RTC is used. In this case, this mesh is transformed through matrixWorld.
        surfaceCenter: useRTE
          ? new Vector3(bs.center_x, bs.center_y, bs.center_z)
          : new Vector3(),
        aabbRadius: bs.radius,
      };

      this._recalculateBoundingSphere();
    }

    return this;
  }

  clone() {
    const cloned = new PolygonMesh(this.ctx, this._layerId) as this;
    cloned.geometry = this.geometry;
    cloned.material = this.material;
    cloned._enhancedMaterial = this._enhancedMaterial;
    return cloned;
  }

  private initGeometry(mesh: NavaraPolygonMesh): {
    success: boolean;
    useRTE: boolean;
  } {
    const { buf } = this.ctx;
    const g = mesh.geometry;

    // Check if RTE attributes are present
    const useRTE =
      g.position_3d_high !== undefined && g.position_3d_high.size > 0;

    const position =
      !useRTE && g.position ? buf.removeF32(g.position.data) : undefined;
    const position_3d_high =
      useRTE && g.position_3d_high
        ? buf.removeF32(g.position_3d_high.data)
        : undefined;
    const position_3d_low =
      useRTE && g.position_3d_low
        ? buf.removeF32(g.position_3d_low.data)
        : undefined;
    const normal = g.normal ? buf.removeF32(g.normal.data) : undefined;
    const scale_normal_and_cap = g.scale_normal_and_cap
      ? buf.removeF32(g.scale_normal_and_cap.data)
      : undefined;
    const indices = buf.removeU32(g.indices);
    const batchIds = g.batch_ids ? buf.removeF32(g.batch_ids.data) : undefined;
    const batchIdSize = g.batch_ids ? g.batch_ids.size : 0;
    const batchIndex = g.batch_index
      ? buf.removeU32(g.batch_index.data)
      : undefined;
    const batchIndexSize = g.batch_index ? g.batch_index.size : 0;

    if (!indices) return { success: false, useRTE: false };
    if (!useRTE && !position) return { success: false, useRTE: false };
    if (useRTE && (!position_3d_high || !position_3d_low))
      return { success: false, useRTE: false };

    const geometry = this.geometry;

    if (useRTE) {
      // RTE mode: set position_3d_high and position_3d_low
      if (
        position_3d_high &&
        position_3d_low &&
        g.position_3d_high &&
        g.position_3d_low
      ) {
        geometry.setAttribute(
          "position_3d_high",
          new BufferAttribute(position_3d_high, g.position_3d_high.size),
        );
        geometry.setAttribute(
          "position_3d_low",
          new BufferAttribute(position_3d_low, g.position_3d_low.size),
        );
      }
    } else {
      // Regular mode: set position
      if (position && g.position) {
        geometry.setAttribute(
          "position",
          new BufferAttribute(position, g.position.size),
        );
      }
    }

    if (g.normal && normal) {
      geometry.setAttribute(
        "normal",
        new BufferAttribute(normal, g.normal.size),
      );
    }
    if (g.scale_normal_and_cap && scale_normal_and_cap) {
      geometry.setAttribute(
        "scaleNormalAndCap",
        new BufferAttribute(scale_normal_and_cap, g.scale_normal_and_cap.size),
      );
    }

    if (batchIds) {
      geometry.setAttribute(
        "attrBatchId",
        new BufferAttribute(batchIds, batchIdSize),
      );
    }

    if (batchIndex) {
      this._setBatchIndex(Float32Array.from(batchIndex), batchIndexSize);
    }

    geometry.setIndex(new BufferAttribute(indices, 1));

    // Ensure a bounding sphere exists before we drop the CPU arrays. When
    // `mesh.bounding_sphere` is provided, init() overwrites this from the
    // WASM AABB (`_baseBoundingSphere`); otherwise this eager compute prevents
    // Three.js from lazily calling computeBoundingSphere() on a nulled array
    // during frustum culling. Batch-id attributes are consumed on the GPU
    // (batch data texture), so no other CPU read survives the first upload.
    // Drop the JS-heap copies to keep a single resident (GPU) copy — see
    // releaseGeometryArraysAfterUpload for the context-loss trade-off.
    geometry.computeBoundingSphere();
    releaseGeometryArraysAfterUpload(geometry);

    return { success: true, useRTE };
  }

  /**
   * Get the enhancer, throwing if not initialized.
   * @throws Error if enhancer is not initialized
   */
  private getEnhancer(): NonNullable<typeof this._enhancedMaterial> {
    if (!this._enhancedMaterial) {
      throw new Error("PolygonMesh must be initialized via init() before use");
    }
    return this._enhancedMaterial;
  }

  private enableWater() {
    if (!this._enhancedMaterial) return;

    const { base, water } = this._enhancedMaterial.states();

    // Disable water normal map if water is off or texturized
    if (!water.useWater || base.isTexturized) {
      this._enhancedMaterial.update({ water: { waterNormalMap: null } });
      return;
    }

    // Skip if not visible or already has water texture
    if (!this.visible || water.waterNormalMap) {
      return;
    }

    // Use shared water texture from CommonUniforms (must be enabled via Options.waterTexture.enabled)
    if (this.ctx.uniforms?.waterTexture.value) {
      this._enhancedMaterial.update({
        water: { waterNormalMap: this.ctx.uniforms.waterTexture.value },
      });
      this.material.needsUpdate = true;
    }
  }

  private initMaterial(
    mesh: NavaraPolygonMesh,
    tileHandle: TileHandle | undefined,
    useRTE: boolean,
  ) {
    const uniforms = this.ctx.uniforms;
    const meshMaterial = mesh.material;
    const mcolor = meshMaterial.color;

    this.castShadow = !!meshMaterial.castShadow;
    this.receiveShadow = !!meshMaterial.receiveShadow;
    applyLitOption(this.material, meshMaterial.lit);

    // This mesh is texturized if it has a tile handle (terrain attachment).
    // `!= null`, not truthiness: the root vector tile's handle is 0.
    const isTexturized = tileHandle != null;
    const material = this.material;

    material.vertexColors = false;
    this.visible = !!meshMaterial.show;

    const uMinMaxHeights = meshMaterial.__internal__?.minMaxHeights;
    const minMaxHeight: [number, number] | undefined = uMinMaxHeights
      ? [uMinMaxHeights[0], uMinMaxHeights[1]]
      : undefined;

    // Ignored if it is cloned.
    if (!this._enhancedMaterial) {
      // Create enhanced material with encapsulated state
      const enhancer = createPolygonMaterialEnhancer(material);
      this._enhancedMaterial = enhancer;
    }
    const enhancer = this._enhancedMaterial;

    // Initialize material state with separated base and water props
    const initialProps: PolygonMaterialProps = {
      base: {
        color: mcolor,
        opacity: meshMaterial.opacity,
        transparent: meshMaterial.transparent,
        wireframe: meshMaterial.wireframe,
        minMaxHeight,
        clampToGround: meshMaterial.clampToGround,
        isTexturized,
        reflectivity: meshMaterial.reflectivity,
        roughness: meshMaterial.roughness,
        emissiveColor: meshMaterial.emissiveColor,
        emissiveIntensity: meshMaterial.emissiveIntensity,
        useRTE,
      },
      water: {
        water: meshMaterial.water,
        waterScaleNormal: meshMaterial.waterScaleNormal,
        waterSpeed: meshMaterial.waterSpeed,
        shininess: meshMaterial.shininess,
        specularStrength: meshMaterial.specularStrength,
        applyWaterNormal: meshMaterial.applyWaterNormal,
        specular: meshMaterial.specular,
        ior: meshMaterial.ior,
        timeUniform: uniforms.time as { value: number },
        skyEnvMap: uniforms.tSkyEnvMap.value,
      },
    };

    // Mount the enhancer
    enhancer.mount(initialProps);

    // Set up RTE if needed
    const { base } = enhancer.states();
    if (base.useRTE) {
      const { base: baseMutates } = enhancer.mutates();
      const callback = setupRTECallback(
        this,
        (modelViewMatrixRTE, cameraPositionHigh, cameraPositionLow) =>
          baseMutates.updateRteUniforms(
            modelViewMatrixRTE,
            cameraPositionHigh,
            cameraPositionLow,
            base,
          ),
      );
      this.onBeforeRender = callback;
      this.onBeforeShadow = callback;
    }

    this.enableWater();

    // Set up custom program cache key based on config flags that affect shader defines
    material.customProgramCacheKey = enhancer.programCacheKey;

    // Set up onBeforeCompile using the enhancer's transformShader
    material.onBeforeCompile = enhancer.transformShader;

    this.ctx.viewContext.applyShadowMaterial(material);

    this._initBatchedMaterial();

    this._update(meshMaterial, mesh.active, isTexturized);
  }

  /**
   * Override a material that is used to generate a shadow map.
   */
  private initDepthMaterial() {
    this.customDepthMaterial = this.material.clone();
    this.customDepthMaterial.needsUpdate = true;

    const origin = this.material;

    // Attach to the batch texture state so layout allocations bump this
    // clone's needsUpdate too — its compiled defines come from the origin, so
    // it must recompile whenever they change.
    attachBatchedMaterial(origin, this.customDepthMaterial);
    // The clone's compiled defines come from the origin, so key its program on
    // the origin's key (which includes the per-instance batch layout defines);
    // the prefix separates it from the origin's own program.
    this.customDepthMaterial.customProgramCacheKey = () =>
      `nvr-depth:${origin.customProgramCacheKey()}`;

    this.customDepthMaterial.onBeforeCompile = (shader, renderer) => {
      origin.onBeforeCompile(shader, renderer);

      shader.defines ??= {};
      Object.assign(shader.defines, origin.userData.defines || {});
      shader.defines["USE_SHADOWMAP_DEPTH"] = 1;
      shader.defines["DEPTH_PACKING"] = RGBADepthPacking;
    };
  }

  _update(material: PolygonMaterial, active: boolean, isTexturized: boolean) {
    const enhancer = this.getEnhancer();

    // Update mesh properties (not handled by enhancer).
    // Draped (clamp-to-ground) polygons bake offscreen only — never the main
    // scene — and the Rust drape resolve, not this LOD `active` flag, picks which
    // baked tile composites per terrain region. Tying bake visibility to `active`
    // makes the drape flicker on LOD swaps; keep a draped mesh bakeable whenever
    // shown so every built tile stays a stable drape source (see
    // PolylineMesh._update).
    const shown = (material.show ?? true) && (material.surfaceShow ?? true);
    this.visible = isTexturized ? shown : shown && active;
    if (this._debugBoundingSphereMesh) {
      this._debugBoundingSphereMesh.visible = this.visible;
    }
    this.castShadow = !!material.castShadow;
    this.receiveShadow = !!material.receiveShadow;
    applyLitOption(this.material, material.lit);

    const { base } = enhancer.states();

    // Build props from material with separated base and water sections
    const minMaxHeights = material.__internal__?.minMaxHeights;
    const updateProps: PolygonMaterialProps = {
      base: {
        // `material.color` is used only when `batchColorEnabled` is `false`.
        // Otherwise the color is update via `setFeatureColor` or the batch data texture.
        color: base.batchColorEnabled ? undefined : material.color,
        opacity: material.opacity,
        transparent: !!material.transparent,
        wireframe: !!material.wireframe,
        minMaxHeight:
          minMaxHeights !== undefined
            ? [minMaxHeights[0], minMaxHeights[1]]
            : undefined,
        clampToGround: !!material.clampToGround,
        isTexturized,
        reflectivity: material.reflectivity,
        roughness: material.roughness,
        emissiveColor: material.emissiveColor,
        emissiveIntensity: material.emissiveIntensity,
        effectIdsMask:
          this.ctx.viewContext.selectiveEffectRegistry?.computeMask(
            material.effectIds ?? [],
          ) ?? 0,
      },
      water: {
        water: !!material.water,
        waterScaleNormal: material.waterScaleNormal,
        waterSpeed: material.waterSpeed,
        shininess: material.shininess,
        specularStrength: material.specularStrength,
        applyWaterNormal: material.applyWaterNormal,
        specular: material.specular,
        ior: material.ior,
      },
    };

    // Update via enhancer
    enhancer.update(updateProps);

    // Post-update actions
    this.enableWater();
    this._recalculateBoundingSphere();
  }

  private _recalculateBoundingSphere() {
    const baseBounds = this._baseBoundingSphere;
    if (!baseBounds || !this._enhancedMaterial) {
      return;
    }

    if (!this.geometry.boundingSphere) {
      this.geometry.boundingSphere = new Sphere();
    }

    // Cache values to avoid multiple calls
    const { base } = this._enhancedMaterial.states();

    if (base.clampToGround) {
      this.geometry.boundingSphere?.set(
        baseBounds.surfaceCenter,
        baseBounds.aabbRadius,
      );
      return;
    }

    const { addHeight, addExtrudedHeight, minMaxHeight } = base;

    if (!minMaxHeight) return;

    // Compute effective min/max considering both uniform and per-feature batch values
    const minHeight = Math.min(
      minMaxHeight[0] + addHeight,
      minMaxHeight[0] + this._minBatchHeight,
    );
    const maxHeight = Math.max(
      minMaxHeight[1] + addHeight + addExtrudedHeight,
      minMaxHeight[1] + this._maxBatchHeight + this._maxBatchExtrudedHeight,
    );

    const heightOffset = (maxHeight - minHeight) / 2.0;
    const centerHeight = (maxHeight + minHeight) / 2.0;

    // Get surface normal from surface center
    const surfaceNormal = baseBounds.surfaceCenter.clone().normalize();

    // Calculate new center by elevating along surface normal
    const center = baseBounds.surfaceCenter
      .clone()
      .add(surfaceNormal.multiplyScalar(centerHeight));

    // Calculate new radius using Pythagorean theorem
    const radius = Math.sqrt(
      baseBounds.aabbRadius * baseBounds.aabbRadius +
        heightOffset * heightOffset,
    );

    // Update geometry bounding sphere
    this.geometry.boundingSphere?.set(center, radius);

    if (DEBUG_BOUNDING_SPHERE) {
      this._updateDebugBoundingSphereMesh(center, radius);
    }
  }

  private _updateDebugBoundingSphereMesh(center: Vector3, radius: number) {
    if (!this._debugBoundingSphereMesh) {
      const geo = new SphereGeometry(1, 16, 12);
      const mat = new MeshBasicMaterial({
        color: 0x00ff00,
        wireframe: true,
        depthTest: false,
        transparent: true,
        opacity: 0.3,
      });
      this._debugBoundingSphereMesh = new ThreeMesh(geo, mat);
      // this._debugBoundingSphereMesh.frustumCulled = false;
      this.add(this._debugBoundingSphereMesh);
    }

    this._debugBoundingSphereMesh.position.copy(center);
    this._debugBoundingSphereMesh.scale.setScalar(radius);
  }

  onBeforePicking(): void {
    this.getEnhancer().update({ base: { pickable: true } });
    this.needsUpdate();
  }

  onAfterPicking(): void {
    this.getEnhancer().update({ base: { pickable: false } });
    this.needsUpdate();
  }

  _updateBatchAttribute(
    batchId: number,
    attribute: BatchedAttributeName,
    value: number | number[] | boolean,
  ): boolean {
    // Write the texture first: a rejected write must not stamp any define —
    // the shaders have no safety net for an unwritten receiver.
    if (!super._updateBatchAttribute(batchId, attribute, value)) return false;

    switch (attribute) {
      case "color": {
        // When batch color is first used, set material.color to white
        // (multiplier identity: white * batch color = batch color).
        if (!this.getEnhancer().states().base.batchColorEnabled) {
          this.getEnhancer().update({
            base: { batchColorEnabled: true, color: 0xffffff },
          });
        }
        break;
      }
      // show and opacity share the packed showOpacity component.
      case "show":
      case "opacity": {
        this.outline?.enableBatchShowOpacity();
        break;
      }
      case "height": {
        this.outline?.enableBatchHeight();
        const h = value as number;
        if (h > this._maxBatchHeight) this._maxBatchHeight = h;
        if (h < this._minBatchHeight) this._minBatchHeight = h;
        this._recalculateBoundingSphere();
        break;
      }
      case "extrudedHeight": {
        this.outline?.enableBatchExtrudedHeight();
        const eh = value as number;
        if (eh > this._maxBatchExtrudedHeight)
          this._maxBatchExtrudedHeight = eh;
        this._recalculateBoundingSphere();
        break;
      }
    }
    return true;
  }

  _getBatchTextureSupport(): BatchTextureSupport {
    return POLYGON_BATCH_SUPPORT;
  }

  _initBatchDataTexture(): void {
    invariant(this.batchLength != null);
    // Register batchLength; the texture itself is created lazily on the
    // first attribute write.
    const uniform = registerBatchedMaterial(
      this.material,
      { ...this._getBatchTextureSupport(), batchLength: this.batchLength },
      this.ctx.viewContext.getRenderer(),
    );
    this.getEnhancer().update({ base: { batchDataTexture: uniform } });
    // Share the same batch texture with outline (no duplicate data)
    this.outline?.initBatchTexture(this.material);
  }

  get water(): boolean {
    return this.getEnhancer().states().water.useWater;
  }
  set water(v: boolean) {
    this.getEnhancer().update({ water: { water: v } });
  }

  /** Properties for material state used by TileMesh for texturized scene rendering */
  get waterScaleNormal(): number {
    return this.getEnhancer().states().water.waterScaleNormal;
  }
  get waterSpeed(): number {
    return this.getEnhancer().states().water.waterSpeed;
  }
  get shininess(): number {
    return this.getEnhancer().states().water.shininess;
  }
  get specularStrength(): number {
    return this.getEnhancer().states().water.specularStrength;
  }
  get applyWaterNormal(): boolean {
    return this.getEnhancer().states().water.applyWaterNormal;
  }
  get specular(): boolean {
    return this.getEnhancer().states().water.specular;
  }
  get reflectivity(): number {
    return this.getEnhancer().states().base.reflectivity;
  }
  get roughness(): number {
    return this.getEnhancer().states().base.roughness;
  }
  get clampToGround(): boolean {
    return this.getEnhancer().states().base.clampToGround;
  }
  get emissiveColor(): number {
    return this.getEnhancer().states().base.emissiveColor;
  }
  get emissiveIntensity(): number {
    return this.getEnhancer().states().base.emissiveIntensity;
  }
  get effectIdsMask(): number {
    return this.getEnhancer().states().base.effectIdsMask;
  }

  dispose() {
    if (this._debugBoundingSphereMesh) {
      this._debugBoundingSphereMesh.geometry.dispose();
      (this._debugBoundingSphereMesh.material as MeshBasicMaterial).dispose();
      this.remove(this._debugBoundingSphereMesh);
      this._debugBoundingSphereMesh = undefined;
    }

    this.ctx.viewContext.removeShadowMaterial(this.material);
    this.customDepthMaterial?.dispose();
  }
}
